import * as path from 'path';
import * as vscode from 'vscode';
import { Host, HostConfig } from './Host';
import { hostname } from 'os';

export class File implements vscode.FileStat {

    type: vscode.FileType;
    mtime: number;
    ctime: number;
    size: number;

    name: string;
    data?: Uint8Array;

    constructor(name: string) {
        this.type = vscode.FileType.File;
        this.ctime = Date.now();
        this.mtime = Date.now();
        this.size = 0;
        this.name = name;
    }
}

export class Directory implements vscode.FileStat {

    type: vscode.FileType;
    ctime: number;
    mtime: number;
    size: number;

    name: string;
    entries: Map<string, File | Directory>;

    constructor(name: string) {
        this.type = vscode.FileType.Directory;
        this.ctime = Date.now();
        this.mtime = Date.now();
        this.size = 0;
        this.name = name;
        this.entries = new Map();
    }
}

export type Entry = File | Directory;

export class PonyFileSystem implements vscode.FileSystemProvider {

    private availableHosts: { [name: string]: HostConfig };
    private activeHosts: { [name: string]: Host };

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

        this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
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

        this._fireSoon(
            { type: vscode.FileChangeType.Deleted, uri: oldUri },
            { type: vscode.FileChangeType.Created, uri: newUri }
        );
    }

    async delete( uri: vscode.Uri ) {
        const [ host, remotePath ] = this.splitPath( uri.path );
        await host.delete( 0, remotePath );

        this._fireSoon( { type: vscode.FileChangeType.Deleted, uri } );
    }

    async createDirectory( uri: vscode.Uri ) {
        const [ host, remotePath ] = this.splitPath( uri.path );
        await host.mkdir( 0, remotePath );

        this._fireSoon( { type: vscode.FileChangeType.Created, uri } );
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
            };
        }

        return hosts;
    }

    // --- manage file contents

    root = new Directory('');


    // --- lookup

    private _lookup(uri: vscode.Uri, silent: false): Entry;
    private _lookup(uri: vscode.Uri, silent: boolean): Entry | undefined;
    private _lookup(uri: vscode.Uri, silent: boolean): Entry | undefined {
        let parts = uri.path.split('/');
        let entry: Entry = this.root;
        for (const part of parts) {
            if (!part) {
                continue;
            }
            let child: Entry | undefined;
            if (entry instanceof Directory) {
                child = entry.entries.get(part);
            }
            if (!child) {
                if (!silent) {
                    throw vscode.FileSystemError.FileNotFound(uri);
                } else {
                    return undefined;
                }
            }
            entry = child;
        }
        return entry;
    }

    private _lookupAsDirectory(uri: vscode.Uri, silent: boolean): Directory {
        let entry = this._lookup(uri, silent);
        if (entry instanceof Directory) {
            return entry;
        }
        throw vscode.FileSystemError.FileNotADirectory(uri);
    }

    private _lookupAsFile(uri: vscode.Uri, silent: boolean): File {
        let entry = this._lookup(uri, silent);
        if (entry instanceof File) {
            return entry;
        }
        throw vscode.FileSystemError.FileIsADirectory(uri);
    }

    private _lookupParentDirectory(uri: vscode.Uri): Directory {
        const dirname = uri.with({ path: path.posix.dirname(uri.path) });
        return this._lookupAsDirectory(dirname, false);
    }

    // --- manage file events

    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private _bufferedEvents: vscode.FileChangeEvent[] = [];
    private _fireSoonHandle?: NodeJS.Timer;

    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    watch(resource: vscode.Uri, opts: any): vscode.Disposable {
        // ignore, fires for all changes...
        return new vscode.Disposable(() => { });
    }

    private _fireSoon(...events: vscode.FileChangeEvent[]): void {
        this._bufferedEvents.push(...events);
        clearTimeout(this._fireSoonHandle!);
        this._fireSoonHandle = setTimeout(() => {
            this._emitter.fire(this._bufferedEvents);
            this._bufferedEvents.length = 0;
        }, 5);
    }
}