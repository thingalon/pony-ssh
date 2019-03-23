import * as vscode from 'vscode';
import NodeCache = require('node-cache');
import { pathToFileURL } from 'url';
import path = require( 'path' );

enum WorkerFileType {
    FILE      = 0x01,
    DIRECTORY = 0x02,
    SYMLINK   = 0x10,
}

export class DirectoryCache {

    private statCache: NodeCache;
    private listCache: NodeCache;

    constructor() {
        this.statCache = new NodeCache( {
            stdTTL: 10,
            checkperiod: 120,
        } );

        this.listCache = new NodeCache( {
            stdTTL: 10,
            checkperiod: 10,
        } );
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

    public parseStat( rawStat: number[] ): vscode.FileStat {
        return {
            type: this.workerFileTypeToVscode( rawStat[0] ),
            ctime: rawStat[1],
            mtime: rawStat[2],
            size: rawStat[3]
        };
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

}
