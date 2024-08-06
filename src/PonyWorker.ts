import * as vscode from 'vscode';
import { encode as msgpackEncode, decode as msgpackDecode } from "msgpack-lite";
import { WorkerError } from "./WorkerError";
import crypto = require( 'crypto' );
import DiffMatchPatch = require( 'diff-match-patch' );
import { EventEmitter } from 'events';
import { log } from './Log';
import { ensureError } from './tools';
import { Channel } from 'ssh2';

export const HashMatch = Symbol( 'HashMatch' );

export enum Opcode {
    LS              = 0x01,
    GET_SERVER_INFO = 0x02,
    FILE_READ       = 0x03,
    FILE_WRITE      = 0x04,
    MKDIR           = 0x05,
    DELETE          = 0x06,
    RENAME          = 0x07,
    EXPAND_PATH     = 0x08,
    FILE_WRITE_DIFF = 0x09,
    ADD_WATCH       = 0x10,
    REMOVE_WATCH    = 0x11,
}

export enum ErrorCode {
    OK      = 0,
    EPERM   = 1,    // Operation not permitted
    ENOENT  = 2,    // No such file / directory
    EIO     = 5,    // IO error
    EBADF   = 9,    // Bad file number
    EAGAIN  = 11,   // Try again
    EACCES  = 13,   // Access denied
    EBUSY   = 16,   // Device busy
    EEXIST  = 17,   // File exists
    EXDEV   = 18,   // Cross-device link
    ENODEV  = 19,   // No such device
    ENOTDIR = 20,   // Not a directory
    EISDIR  = 21,   // Is a directory
    EINVAL  = 22,   // Invalid argument
    EROFS   = 30,   // Read-only filesystem
    ERANGE  = 34,   // Out of range
    ENOSYS  = 38,   // Function not implemented
    ENODATA = 61,   // No data available
}

enum DiffAction {
    UNCHANGED = 0x00,
    INSERTED  = 0x01,
    REMOVED   = 0x02,
}

export enum ParcelType {
    // Request responses
    HEADER    = 0x01,
    BODY      = 0x02,
    ERROR     = 0x03,
    ENDOFBODY = 0x04,

    // Push notifications
    WARNING       = 0x05,
    CHANGE_NOTICE = 0x06,
}
    
const headerSizes: { [size: number]: number } = {
    0xcc: 3,
    0xcd: 4,
    0xce: 6,
    0xcf: 10,
};

interface ParcelChunk {
    [key: string]: any;
}

type ParcelConsumer = ( type: ParcelType, body: Buffer ) => boolean;
type BodyCB = ( data: Buffer ) => void;

// Testable interface - describes everything we use from the SSH2 channel class.
export interface ChannelInterface {
    on( event: 'data',  listener: ( data: Buffer ) => void ): void;
    on( event: 'error', listener: ( error: Error ) => void ): void;
    on( event: 'end',   listener: () => void ): void;
    stderr: { on( event: 'data', listener: ( data: Buffer ) => void ): void };
    write( data: Buffer ): void;
    close(): void;
};

export class PonyWorker extends EventEmitter {

    private channel?: ChannelInterface;
    private readBuffer : Buffer;
    private bufferMsgSize: number | undefined;
    private parcelConsumer: ParcelConsumer | undefined;
    private closing: boolean;

    public constructor( channel: ChannelInterface ) {
        super();

        this.channel = channel;
        this.readBuffer = Buffer.alloc( 0 );
        this.bufferMsgSize = undefined;
        this.parcelConsumer = undefined;
        this.closing = false;

        this.channel.stderr.on( 'data', this.onChannelStderr.bind( this ) );
        this.channel.on( 'data', this.onChannelData.bind( this ) );
        this.channel.on( 'error', this.onChannelError.bind( this ) );
        this.channel.on( 'end', this.onChannelEnd.bind( this ) );
    }

    public async getServerInfo(): Promise<ParcelChunk> {
        return await this.get( Opcode.GET_SERVER_INFO, {} );
    }

    public async expandPath( remotePath: string ): Promise<string> {
        const response = await this.get( Opcode.EXPAND_PATH, { path: remotePath } );
        return response.path;
    }

    public async ls( path: string ) {
        return await this.get( Opcode.LS, { path: path } );
    }

    public async readFile( remotePath: string, cachedHash?: string ): Promise<Uint8Array | Symbol> {
        const chunks: Buffer[] = [];
        const header = await this.get( Opcode.FILE_READ, { path: remotePath, cachedHash: cachedHash }, ( chunk: Buffer ) => {
            chunks.push( chunk );
        } );

        if ( header.hashMatch ) {
            console.log( 'opening based on hashmatch' );
            return HashMatch;
        }

        return Buffer.concat( chunks );
    }

    public async writeFile( remotePath: string, data: Uint8Array, options: { create: boolean, overwrite: boolean } ) {
        return await this.get( Opcode.FILE_WRITE, {
            path: remotePath,
            data: data,
            create: options.create,
            overwrite: options.overwrite,
        } );
    }

    public async writeFileDiff( remotePath: string, originalContent: Uint8Array, updatedContent: Uint8Array ) {
        const originalString = Buffer.from( originalContent ).toString( 'binary' );
        const updatedString = Buffer.from( updatedContent ).toString( 'binary' );

        const differ = new DiffMatchPatch();
        const rawDiff = differ.diff_main( originalString, updatedString, undefined, undefined );
        differ.diff_cleanupEfficiency( rawDiff );

        // Grind up the generated diff into a flat array efficient for msgpack. 
        // Array contains pairs of elements; [ action, data, action, data, ... ]
        // - Data for INSERTED action is the data to insert,
        // - Data for REMOVED or UNCHANGED actions is the number of bytes to exclude or copy from the original.
        // Give up if diff seems to be larger than the whole file, based on approximation of msgpack'd size: 
        // - 3 bytes per diff action (1-byte action + 1-5 byte action size)
        // - Plus the total size of bytes inserted via the diff
        const diff = [];
        let approxDiffSize = rawDiff.length * 3;
        for ( const diffPiece of rawDiff ) {
            if ( diffPiece[0] === 1 ) {
                diff.push( DiffAction.INSERTED );
                diff.push( diffPiece[1] );
                approxDiffSize += diffPiece[1].length;
            } else if ( diffPiece[0] === -1 ) {
                diff.push( DiffAction.REMOVED );
                diff.push( diffPiece[1].length );
            } else {
                diff.push( DiffAction.UNCHANGED );
                diff.push( diffPiece[1].length );
            }

            if ( approxDiffSize > updatedContent.length ) {
                throw new Error( 'Giving up on preparing a diff; it is likely to be larger than just writing the file' );
            }
        }

        const hashBefore = crypto.createHash( 'md5' ).update( originalContent ).digest( 'hex' );
        const hashAfter = crypto.createHash( 'md5' ).update( updatedContent ).digest( 'hex' );

        return await this.get( Opcode.FILE_WRITE_DIFF, {
            path: remotePath,
            hashBefore,
            hashAfter,
            diff
        } );
    }

    public async rename( fromPath: string, toPath: string, options: { overwrite: boolean } ) {
        return await this.get( Opcode.RENAME, {
            from: fromPath,
            to: toPath,
            overwrite: options.overwrite,
        } );
    }

    public async delete( remotePath: string ) {
        return await this.get( Opcode.DELETE, {
            path: remotePath,
        } );
    }

    public async mkdir( remotePath: string ) {
        return await this.get( Opcode.MKDIR, {
            path: remotePath,
        } );
    }

    private onChannelData( data: Buffer ) {
        try {
            this.readBuffer = Buffer.concat( [ this.readBuffer, data ] );

            // Try to read messages in the buffer. Minimum possible parcel size is 2 bytes.
            while ( this.readBuffer.length >= 2 ) {
                // First byte defines parcel type. Make sure it looks valid.
                const parcelType = this.readBuffer[0] as ParcelType;
                if ( parcelType > ParcelType.CHANGE_NOTICE ) {
                    // I guess read whatever is available.
                    log.debug( this.readBuffer.toString() );
                    throw new Error( 'Invalid parcel type: ' + parcelType );
                }

                // Second byte is the start of a msgpack-formatted integer body size.
                const headerSize = headerSizes[ this.readBuffer[1] ] || 2;
                if ( this.readBuffer.length < headerSize ) {
                    break;
                }

                if ( this.bufferMsgSize === undefined ) {
                    this.bufferMsgSize = msgpackDecode( this.readBuffer.slice( 1, headerSize ) );
                }

                // Check if a whole message is ready to read.
                const totalMessageSize = headerSize + this.bufferMsgSize!;
                if ( this.readBuffer.length < totalMessageSize ) {
                    break;
                }

                const message = this.readBuffer.slice( headerSize, totalMessageSize );
                this.readBuffer = this.readBuffer.slice( totalMessageSize );
                this.bufferMsgSize = undefined;

                this.onParcel( parcelType, message );
            }
        } catch ( err ) {
            log.error( 'Error parsing channel data: ', err );
            this.onChannelError( ensureError( err ) );
        }
    }

    private processError( code: ErrorCode, message: string ): Error {
        switch ( code ) {
            case ErrorCode.EPERM:
            case ErrorCode.EACCES:
            case ErrorCode.EROFS:
                return vscode.FileSystemError.NoPermissions( message );

            case ErrorCode.ENOENT:
                return vscode.FileSystemError.FileNotFound( message );

            case ErrorCode.EEXIST:
                return vscode.FileSystemError.FileExists( message );

            case ErrorCode.EAGAIN:
            case ErrorCode.EBUSY:
            case ErrorCode.ENODEV:
                return vscode.FileSystemError.Unavailable( message );

            case ErrorCode.ENOTDIR:
                return vscode.FileSystemError.FileNotADirectory( message );

            case ErrorCode.EISDIR:
                return vscode.FileSystemError.FileIsADirectory( message );

            default:
                return new WorkerError( code, message );
        }
    }

    private async get( opcode: Opcode, args: Object, bodyCallback: BodyCB | undefined = undefined ): Promise<ParcelChunk> {
        return new Promise( ( resolve, reject ) => {
            let header: ParcelChunk | undefined = undefined;
            let bodyLength: number = 0;

            const before = Date.now();

            this.setParcelConsumer( ( type: ParcelType, data: Buffer ): boolean => {
                switch ( type ) {
                    case ParcelType.ERROR:
                        const details = msgpackDecode( data );
                        reject( this.processError( details.code, details.error ) );
                        return false;

                    case ParcelType.HEADER:
                        console.log( 'Got a header for ' + opcode + ' in ' + ( Date.now() - before ) );
                        header = msgpackDecode( data );
                        if ( header && ! header.length ) {
                            // Header with no body. We're done here.
                            resolve( header! );
                            return false;
                        } else {
                            return true;
                        }

                    case ParcelType.BODY:
                        bodyLength += data.length;
                        if ( bodyCallback ) {
                            bodyCallback( data );
                        }
                        return true;

                    case ParcelType.ENDOFBODY:
                        if ( header !== undefined ) {
                            if ( bodyLength !== header.length ) {
                                log.warn( 'Warning: Header said ' + header.length + ' bytes, body was ' + bodyLength + 'bytes' );
                            }
                            resolve( header! );
                        } else {
                            reject( new Error( 'End of Body without a header' ) );
                        }
                        return false;
                    
                    default:
                        log.warn( 'Unexpected parcel type: ', type );
                        return false;
                }
            } );

            console.log( 'Sending ' + opcode + ' ' + JSON.stringify( args ) );
            this.sendMessage( opcode, args );
        } );
    }

    private setParcelConsumer( consumer: ParcelConsumer ) {
        if ( this.parcelConsumer !== undefined ) {
            this.onChannelError( new Error( 'Parcel consumer reset without closing previous parcel' ) );
        }

        this.parcelConsumer = consumer;
    }

    protected sendMessage( opcode: Opcode, args: any ) {
        if ( ! this.channel ) {
            throw new Error( 'Attempt to send message after closing worker channel' );
        }

        const data = this.packMessage( opcode, args );
        this.channel.write( data );
    }

    private packMessage( opcode: Opcode, args: any ) {
        let packed = msgpackEncode( [ opcode, args ] );
        if ( packed.length < 16 ) {
            const padded = Buffer.alloc( 16 );
            packed.copy( padded );
            packed = padded;
        }

        const header = msgpackEncode( packed.length );
        return Buffer.concat( [ header, packed ] );
    }

    private close() {
        this.closing = true;

        if ( this.channel ) {
            this.channel.close();
            this.channel = undefined;
        }
    }

    protected onChannelError( err: Error ) {
        this.close();
        this.emit( 'error', this, err );
    }

    private onChannelStderr( data: Buffer ) {
        const stringData = data.toString();

        if ( stringData.trim().length > 0 ) {
            log.warn( 'Channel STDERR output: ', stringData );
        }
    }

    private onChannelEnd() {
        if ( ! this.closing ) {
            this.onChannelError( new Error( 'Unexpected end of worker channel' ) );
        }
    }

    protected onParcel( type: ParcelType, body: Buffer ) {
        if ( ! this.parcelConsumer ) {
            const parcelTypeName = ParcelType[ type ];
            const bodyJson = JSON.stringify( body );
            const error = new Error( 'Received parcel without a consumer waiting: ' + parcelTypeName + ' ' + bodyJson );
            return this.onChannelError( error );
        }

        const moreToReceive = this.parcelConsumer( type, body );
        if ( ! moreToReceive ) {
            this.parcelConsumer = undefined;
        }
    }

}