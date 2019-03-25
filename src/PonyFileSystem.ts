import * as path from 'path';
import * as vscode from 'vscode';
import { Host, HostConfig } from './Host';
import { hostname } from 'os';

export class PonyFileSystem implements vscode.FileSystemProvider {

    private availableHosts: { [name: string]: HostConfig };
    private activeHosts: { [name: string]: Host };

    private emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private bufferedEvents: vscode.FileChangeEvent[] = [];
    private fireSoonHandle?: NodeJS.Timer;
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.emitter.event;

    constructor( context: vscode.ExtensionContext ) {
        this.activeHosts = {};
        this.availableHosts = this.loadHostConfigs();
    }

    public getAvailableHosts() {
        return this.availableHosts;
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

    public watch( resource: vscode.Uri, opts: any ): vscode.Disposable {
        // TODO.
        return new vscode.Disposable( () => {} );
    }

    private splitPath( fullPath: string ): [ Host, string ] {
        const pieces = fullPath.split( '/' ).filter( x => x.length > 0 );
        const hostName = pieces.shift()!;
        const remotePath = ( pieces.length > 0 && pieces[0] === '~' ? '' : '/' ) + pieces.join( '/' );

        if ( ! this.availableHosts[ hostName ] ) {
            throw vscode.FileSystemError.FileNotFound( fullPath );
        }

        if ( ! this.activeHosts[ hostName ] ) {
            this.activeHosts[ hostName ] = new Host( this.availableHosts[ hostName ] );
        }

        return [ this.activeHosts[ hostName ], remotePath ];
    }

    private loadHostConfigs(): { [name: string]: HostConfig } {
        const hosts: { [name: string]: HostConfig } = {};

        const defaultAgent = ( 'win32' === process.platform ? 'pageant' : process.env.SSH_AUTH_SOCK );

        const config = vscode.workspace.getConfiguration( 'ponyssh' );
        const configHosts = config && config.hosts || {};
        for ( const name in configHosts ) {
            const configHost = configHosts[ name ];
            hosts[ name ] = {
                "host": configHost.host,
                "username": configHost.username,
                "agent": configHost.agent || ( configHost.password ? undefined : defaultAgent ),
                "path": configHost.path,
            };
        }

        return hosts;
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