import * as vscode from 'vscode';
import { Host, HostConfig } from './Host';
import path = require( 'path' );
import fs = require( 'fs' ); // TODO: Port to fs.promises when vscode moves to Node 10.3
import util = require( 'util' );
import rimraf = require( 'rimraf' );
import { log } from './Log';

export class PonyFileSystem implements vscode.FileSystemProvider {

    private availableHosts: { [name: string]: HostConfig };
    private activeHosts: { [name: string]: Host };
    private nextWatchId: number;
    private cachePath: string;

    private emitter: vscode.EventEmitter<vscode.FileChangeEvent[]>;
    private bufferedEvents: vscode.FileChangeEvent[];
    private fireSoonHandle?: NodeJS.Timer;
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;

    constructor( context: vscode.ExtensionContext ) {
        this.emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
        this.bufferedEvents = [];
        this.onDidChangeFile = this.emitter.event;

        this.activeHosts = {};
        this.availableHosts = this.loadHostConfigs();
        this.nextWatchId = 1;

        this.cachePath = path.join( context.globalStoragePath, 'cache' );

        // Kick off a process 10s after startup to purge host caches that don't exist.
        setTimeout( () => { this.purgeDeletedHostCaches(); }, 1000 * 10 );
    }

    public getAvailableHosts(): { [name: string]: HostConfig; } {
        return this.availableHosts;
    }

    public getActiveHosts(): { [name: string]: Host } {
        return this.activeHosts;
    }

    public async stat( uri: vscode.Uri ): Promise<vscode.FileStat> {
        const [ host, remotePath ] = this.splitPath( uri.path );
        return await host.stat( 0, remotePath );
    }

    public async readDirectory( uri: vscode.Uri ): Promise<[string, vscode.FileType][]> {
        const [ host, remotePath ] = this.splitPath( uri.path );
        return await host.ls( 0, remotePath );
    }

    public async readFile( uri: vscode.Uri ): Promise<Uint8Array> {
        const [ host, remotePath ] = this.splitPath( uri.path );
        return await host.readFile( 0, remotePath );
    }

    public async writeFile( uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean } ) {
        const [ host, remotePath ] = this.splitPath( uri.path );
        await host.writeFile( 0, remotePath, content, options );

        this.fireSoon({ type: vscode.FileChangeType.Changed, uri });
    }

    public async rename( oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean } ) {
        if ( oldUri.scheme !== 'ponyssh' || newUri.scheme !== 'ponyssh' ) {
            throw new Error( 'Cannot rename files between different schemas' );
        }

        const [ oldHost, oldPath ] = this.splitPath( oldUri.path );
        const [ newHost, newPath ] = this.splitPath( newUri.path );

        if ( oldHost !== newHost ) {
            throw new Error( 'Cannot rename files between different remote hosts' );
        }

        await newHost.rename( 0, oldPath, newPath, options );

        this.fireSoon(
            { type: vscode.FileChangeType.Deleted, uri: oldUri },
            { type: vscode.FileChangeType.Created, uri: newUri }
        );
    }

    async delete( uri: vscode.Uri ) {
        const [ host, remotePath ] = this.splitPath( uri.path );
        await host.delete( 0, remotePath );

        this.fireSoon( { type: vscode.FileChangeType.Deleted, uri } );
    }

    async createDirectory( uri: vscode.Uri ) {
        const [ host, remotePath ] = this.splitPath( uri.path );
        await host.mkdir( 0, remotePath );

        this.fireSoon( { type: vscode.FileChangeType.Created, uri } );
    }

    public watch( uri: vscode.Uri, options: { recursive: boolean, excludes: string[] } ): vscode.Disposable {
        const [ host, remotePath ] = this.splitPath( uri.path );
        const watchId = this.nextWatchId++;
        const addPromise = host.addWatch( watchId, remotePath, options, this.handleFileChange.bind( this ) );

        addPromise.catch( ( err ) => {
            vscode.window.showWarningMessage( 'Failed to watch path: ' + err.message, { modal: false } );
        } );

        return new vscode.Disposable( () => {
            host.rmWatch( watchId );
        } );
    }
    
    public handleFileChange( host: string, remotePath: string, type: vscode.FileChangeType ) {
        const fullPath = 'ponyssh:/' + host + ( remotePath.startsWith( '/' ) ? '' : '/' ) + remotePath;
        const uri = vscode.Uri.parse( fullPath );

        this.fireSoon( { type, uri } );
    }

    public getActiveHost( name: string ): Host {
        if ( ! this.activeHosts[ name ] ) {
            this.activeHosts[ name ] = new Host( this.cachePath, name, this.availableHosts[ name ] );
        }

        return this.activeHosts[ name ];
    }

    public resetHostConnection( name: string ) {
        if ( this.activeHosts[ name ] ) {
            this.activeHosts[ name ].resetConnection();
        }
    }

    private splitPath( fullPath: string ): [ Host, string ] {
        const pieces = fullPath.split( '/' ).filter( x => x.length > 0 );
        const hostName = pieces.shift()!;
        const remotePath = ( pieces.length > 0 && pieces[0] === '~' ? '' : '/' ) + pieces.join( '/' );

        if ( ! this.availableHosts[ hostName ] ) {
            throw vscode.FileSystemError.FileNotFound( fullPath );
        }

        const host = this.getActiveHost( hostName );
        return [ host, remotePath ];
    }

    private loadHostConfigs(): { [name: string]: HostConfig } {
        const hosts: { [name: string]: HostConfig } = {};

        const defaultAgent = ( 'win32' === process.platform ? 'pageant' : process.env.SSH_AUTH_SOCK );

        const config = vscode.workspace.getConfiguration( 'ponyssh' );
        const configHosts = config && config.hosts || {};
        for ( const name in configHosts ) {
            const configHost = configHosts[ name ];
            hosts[ name ] = {
                host: configHost.host,
                username: configHost.username,
                agent: configHost.agent || ( configHost.password ? undefined : defaultAgent ),
                path: configHost.path,
                python: configHost.python,
                privateKey: configHost.privateKey,
                privateKeyFile: configHost.privateKeyFile,
                passphrase: configHost.passphrase,
            };
        }

        return hosts;
    }

    // Run once at startup, deletes cache directories for hosts that no longer exist.
    private async purgeDeletedHostCaches() {
        const readdir = util.promisify( fs.readdir );

        try {
            const cacheDirs = await readdir( this.cachePath );
            for ( const hostName of cacheDirs ) {
                if ( ! this.availableHosts[ hostName ] ) {
                    const fullPath = path.join( this.cachePath, hostName );

                    // Paranoid checks: rimraf recursively deletes directories. 
                    // Make sure the path contains 'Code', 'pony-ssh' and 'cache'.
                    for ( const keyword of [ 'Code', 'pony-ssh', 'cache' ] ) {
                        if ( ! fullPath.includes( keyword ) ) {
                            throw new Error( 'Cache folder does not contain expected strings: ' + fullPath );
                        }
                    }

                    rimraf( fullPath, ( err ) => {
                        if ( err ) {
                            log.warn( 'Failed to delete cache folder for deleted host ' + fullPath + ': ', err );
                        }
                    } );
                }
            }
        } catch ( err ) {
            log.warn( 'Failed to purge cache folders from deleted hosts: ', err );
        }
    }

    private fireSoon( ...events: vscode.FileChangeEvent[] ): void {
        this.bufferedEvents.push( ...events );
        clearTimeout( this.fireSoonHandle! );
        this.fireSoonHandle = setTimeout( () => {
            this.emitter.fire( this.bufferedEvents );
            this.bufferedEvents.length = 0;
        }, 5);
    }
}