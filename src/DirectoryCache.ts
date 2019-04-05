import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import mkdirp = require('mkdirp-promise');
import * as fs from 'fs';
import NodeCache = require('node-cache');
import rmfr = require( 'rmfr' );

enum WorkerFileType {
    FILE      = 0x01,
    DIRECTORY = 0x02,
    SYMLINK   = 0x10,
}

export class DirectoryCache {

    private statCache: NodeCache;
    private listCache: NodeCache;

    private unsafePathChars: RegExp = /[\/\\\:\*\?\"\<\>\|]/g;
    private fileCacheBase: string;
    private fileCacheKey: Buffer | undefined;

    constructor( fileCacheBase: string ) {
        this.fileCacheBase = fileCacheBase;

        this.statCache = new NodeCache( {
            stdTTL: 10,
            checkperiod: 120,
        } );

        this.listCache = new NodeCache( {
            stdTTL: 10,
            checkperiod: 120,
        } );
    }

    public async setFileCacheKey( key: Buffer, newKey: boolean ) {
        if ( newKey ) {
            await rmfr( path.join( this.fileCacheBase, 'files' ) );
        }

        this.fileCacheKey = key;
    }

    public normalizePath( path: string ): string {
        return path.split( '/' ).filter( x => x ).join( '/' );
    }

    public getStat( statPath: string ): vscode.FileStat | undefined {
        return this.statCache.get( this.normalizePath( statPath ) );
    }

    public setStat( statPath: string, stat: vscode.FileStat ) {
        this.statCache.set( this.normalizePath( statPath ), stat );
    }

    public clearStat( statPath: string ) {
        this.statCache.del( this.normalizePath( statPath ) );
    }

    public getListing( basePath: string ): [string, vscode.FileType][] | undefined {
        return this.listCache.get( this.normalizePath( basePath ) );
    }

    public setListing( basePath: string, rawListing: { [ name: string ]: number[] } ) {
        const listing: [string, vscode.FileType][] = [];
        for ( const name in rawListing ) {
            const stat = this.parseStat( rawListing[ name ] );
            listing.push( [ name, stat.type ] );
            this.setStat( path.posix.join( basePath, name ), stat );
        }

        this.listCache.set( this.normalizePath( basePath ), listing );
    }

    public clearListing( basePath: string ) {
        this.listCache.del( this.normalizePath( basePath ) );
    }

    public parseStat( rawStat: number[] ): vscode.FileStat {
        return {
            type: this.workerFileTypeToVscode( rawStat[0] ),
            ctime: rawStat[1],
            mtime: rawStat[2],
            size: rawStat[3]
        };
    }

    async setFile( remotePath: string, content: Uint8Array ) {
        if ( ! this.fileCacheKey ) {
            return;
        }

        try {
            const storagePath = this.fileCachePath( remotePath );
            await mkdirp( path.dirname( storagePath ) );

            const iv = crypto.randomBytes( 16 );
            const cipher = crypto.createCipheriv( 'aes-256-cbc', this.fileCacheKey, iv );
            const encrypted = Buffer.concat( [ iv, cipher.update( content ), cipher.final() ] );

            // TODO: Once fs.promises is out of "experimental", replace with that.
            await new Promise( ( resolve, reject ) => {
                fs.writeFile( storagePath, encrypted, ( err ) => {
                    if ( err ) {
                        reject( err );
                    } else {
                        resolve();
                    }
                } );
            } );
        } catch ( err ) {
            vscode.window.showWarningMessage( 'Failed to cache file ' + remotePath + ': ' + err.message, { modal: false } );
        }
    }

    async getFile( remotePath: string ): Promise<Uint8Array | undefined> {
        if ( ! this.fileCacheKey ) {
            return undefined;
        }

        try {
            const storagePath = this.fileCachePath( remotePath );

            // TODO: Once fs.promises is out of "experimental", replace with that.
            const fileContent = await new Promise<Buffer>( ( resolve, reject ) => {
                fs.readFile( storagePath, ( err, data ) => {
                    if ( err ) {
                        reject( err );
                    } else {
                        resolve( data );
                    }
                } );
            } );

            const iv = fileContent.slice( 0, 16 );
            const encrypted = fileContent.slice( 16 );

            const decipher = crypto.createDecipheriv( 'aes-256-cbc', this.fileCacheKey, iv );
            return Buffer.concat( [ decipher.update( encrypted ), decipher.final() ] );
        } catch ( err ) {
            return undefined;
        }
    }

    private workerFileTypeToVscode( workerFileType: WorkerFileType ): vscode.FileType {
        let type: vscode.FileType = vscode.FileType.Unknown;

        if ( workerFileType & WorkerFileType.FILE ) {
            type = vscode.FileType.File;
        } else if ( workerFileType & WorkerFileType.DIRECTORY ) {
            type = vscode.FileType.Directory;
        }

        if ( workerFileType & WorkerFileType.SYMLINK ) {
            type += vscode.FileType.SymbolicLink;
        }

        return type;
    }

    // Given a filename, keep it unique, free from special chars and length-limited for use in cache path
    private stripPathPiece( pathPiece: string ): string {
        const clean = pathPiece.replace( this.unsafePathChars, '-' ).substr( 0, 100 );
        if ( clean === pathPiece ) {
            return pathPiece;
        } else {
            return clean + '-' + crypto.createHash( 'md5' ).update( pathPiece ).digest( 'hex' );
        }
    }

    // Strip a remote path to make it friendly to store on most local filesystems
    private fileCachePath( remotePath: string ): string {
        const pieces = remotePath.split( '/' ).filter( x => x ).map( this.stripPathPiece.bind( this ) );
        return path.join( this.fileCacheBase, 'files', ...pieces );
    }

}
