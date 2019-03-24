import { Connection } from "./Connection";
import { Channel } from "ssh2";
import { encode as msgpackEncode, decode as msgpackDecode } from "msgpack-lite";
import { WorkerError } from "./WorkerError";
import { formatWithOptions } from "util";

type BufferSource = Buffer;

enum Opcode {
    LS              = 0x01,
    GET_SERVER_INFO = 0x02,
    FILE_READ       = 0x03,
    FILE_WRITE      = 0x04,
    MKDIR           = 0x05,
    DELETE          = 0x06,
    RENAME          = 0x07,
}

enum ParcelType {
    HEADER    = 0x01,
    BODY      = 0x02,
    ERROR     = 0x03,
    ENDOFBODY = 0x04
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

export class PonyWorker {

    private connection: Connection;
    private channel: Channel;
    private readBuffer : Buffer;
    private bufferMsgSize: number | undefined;
    private parcelConsumer: ParcelConsumer | undefined;

    public constructor( connection: Connection, channel: Channel ) {
        this.connection = connection;
        this.channel = channel;
        this.readBuffer = Buffer.alloc( 0 );
        this.bufferMsgSize = undefined;
        this.parcelConsumer = undefined;

        this.channel.stderr.on( 'data', this.onChannelStderr.bind( this ) );
        this.channel.on( 'data', this.onChannelData.bind( this ) );
        this.channel.on( 'error', this.onChannelError.bind( this ) );
        this.channel.on( 'end', this.onChannelEnd.bind( this ) );
    }

    public async getServerInfo(): Promise<ParcelChunk> {
        return await this.get( Opcode.GET_SERVER_INFO, {} );
    }

    public async ls( path: string ) {
        return await this.get( Opcode.LS, { path: path } );
    }

    public async readFile( remotePath: string ): Promise<Uint8Array> {
        const chunks: Buffer[] = [];
        await this.get( Opcode.FILE_READ, { path: remotePath }, ( chunk: Buffer ) => {
            chunks.push( chunk );
        } );

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
                if ( parcelType > ParcelType.ENDOFBODY ) {
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
            console.log( 'Error parsing channel data: ' );
            console.log( err );
            this.onChannelError( err );
        }
    }

    private async get( opcode: Opcode, args: Object, bodyCallback: BodyCB | undefined = undefined ): Promise<ParcelChunk> {
        return new Promise( ( resolve, reject ) => {
            let header: ParcelChunk | undefined = undefined;
            let bodyLength: number = 0;

            this.setParcelConsumer( ( type: ParcelType, data: Buffer ): boolean => {
                switch ( type ) {
                    case ParcelType.ERROR:
                        const details = msgpackDecode( data );
                        reject( new WorkerError( details.code, details.error ) );
                        return false;

                    case ParcelType.HEADER:
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
                                console.warn( 'Warning: Header said ' + header.length + ' bytes, body was ' + bodyLength + 'bytes' );
                            }
                            resolve( header! );
                        } else {
                            reject( new Error( 'End of Body without a header' ) );
                        }
                        return false;
                }
            } );

            this.sendMessage( opcode, args );
        } );
    }

    private setParcelConsumer( consumer: ParcelConsumer ) {
        if ( this.parcelConsumer !== undefined ) {
            this.onChannelError( new Error( 'Parcel consumer reset without closing previous parcel' ) );
        }

        this.parcelConsumer = consumer;
    }

    private sendMessage( opcode: Opcode, args: any ) {
        const data = this.packMessage( opcode, args );
        this.channel.write( data );
    }

    private packMessage( opcode: Opcode, args: any ) {
        const packed = msgpackEncode( [ opcode, args ] );
        const header = msgpackEncode( packed.length );
        return Buffer.concat( [ header, packed ] );
    }

    private onChannelError( err: Error ) {
        // TODO: gracefully close channel
        console.error( err );
    }

    private onChannelStderr( data: string ) {
        console.log( 'Channel STDERR: ' + data );
    }

    private onChannelEnd() {
        // TODO: Handle graceful close. For now treat all closures as rough.
        this.onChannelError( new Error( 'Unexpected end of worker channel' ) );
    }

    private onParcel( type: ParcelType, body: Buffer ) {
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