import { ClientHttp2Session } from "http2";
import { Connection } from "./Connection";
import { DirectoryCache } from "./DirectoryCache";
import * as vscode from 'vscode';
import path = require( 'path' );

export interface HostConfig {
    host: string;
    username: string;
    agent?: string;
}

export class Host {

    private connection: Connection;
    private directoryCache: DirectoryCache;
    private connectionPromise: Promise<void> | undefined;

    constructor( config: HostConfig ) {
        this.connection = new Connection( config );
        this.directoryCache = new DirectoryCache();
    }

    public async connect() {
        if ( ! this.connectionPromise ) {
            this.connectionPromise = this.connection.connect();
        }

        return this.connectionPromise;
    }

    public async stat( priority: number, remotePath: string ) : Promise<vscode.FileStat> {
        await this.connect();

        const cachedStat = this.directoryCache.getStat( remotePath );
        if ( cachedStat ) {
            return cachedStat!;
        }

        await this.cacheLs( priority, remotePath );

        const stat = this.directoryCache.getStat( remotePath );
        if ( ! stat ) {
            // We should never reach this point. It should fail in the stop before.
            throw new Error( 'Stat not in cache after successful listing' );
        }

        return stat;
    }

    public async ls( priority: number, remotePath: string ) : Promise<[string, vscode.FileType][]> {
        await this.connect();

        const cachedListing = this.directoryCache.getListing( remotePath );
        if ( cachedListing ) {
            return cachedListing!;
        }

        await this.cacheLs( priority, remotePath );

        const listing = this.directoryCache.getListing( remotePath );
        if ( ! listing ) {
            // We should never reach this point. It should fail in the stop before.
            throw new Error( 'Listing not in cache after successful ls' );
        }

        return listing;
    }

    public async readFile( priority: number, remotePath: string ): Promise<Uint8Array> {
        await this.connect();
        return await this.connection.readFile( priority, remotePath );
    }

    public async writeFile( priority: number, remotePath: string, data: Uint8Array, options: { create: boolean, overwrite: boolean } ) {
        await this.connect();
        await this.connection.writeFile( priority, remotePath, data, options );
    }

    public async rename( priority: number, fromPath: string, toPath: string, options: { overwrite: boolean } ) {
        await this.connect();
        await this.connection.rename( priority, fromPath, toPath, options );
    }

    public async delete( priority: number, remotePath: string ) {
        await this.connect();
        await this.connection.delete( priority, remotePath );
    }

    public async mkdir( priority: number, remotePath: string ) {
        await this.connect();
        await this.connection.mkdir( priority, remotePath );
    }

    private async cacheLs( priority: number, remotePath: string ) {
        const response = await this.connection.ls( priority, remotePath );
        this.directoryCache.setStat( remotePath, this.directoryCache.parseStat( response.stat ) );
        for ( const dir in response.dirs ) {
            this.directoryCache.setListing( path.posix.join( remotePath, dir ), response.dirs[ dir ] );
        }
    }

}
