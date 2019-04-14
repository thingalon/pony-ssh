import { HostConfig, Host } from "./Host";
import { Client, Channel, ConnectConfig} from 'ssh2';
import { WorkerScript } from "./WorkerScript";
import { PonyWorker } from "./PonyWorker";
import { PriorityPool } from "./PriorityPool";
import { WatchWorker } from "./WatchWorker";
import { EventEmitter } from "events";
import { StatusTicker } from "./StatusTicker";
import fs = require( 'fs' );
import util = require( 'util' );
import * as vscode from 'vscode';
import expandHomeDir = require( 'expand-home-dir' );
import { log, LoggingLevel } from "./Log";
const shellEscape = require( 'shell-escape' );

const pilotCommand = '' +
    'F=~/.pony-ssh/worker.zip;' +
    'M="ponyssh-mar""ker";' +
    'if command -v python >/dev/null;then ' +
        'if [ -e $F ];then ' +
            'if [ $( which md5 ) ];then ' +
                'H=`cat $F|md5`;' +
            'else ' +
                'H=`cat $F|md5sum`;' +
            'fi;' +
            'echo "[$M h $H]";' +
        'else ' +
            'echo "[$M n]";' +
        'fi;' +
    'else ' +
        'echo "[$M p]";' +
    'fi;';

const uploadCommand = '' +
    'import os,sys;' +
    'd=os.path.expanduser("~/.pony-ssh");' +
    'os.path.exists(d) or os.mkdir(d);' +
    'f=open(d+"/worker.zip","w");' +
    'f.write(sys.stdin.read())';

export interface ServerInfo {
    home: string;
    cacheKey: string;
    newCacheKey: boolean;
}

export class Connection extends EventEmitter {

    public host: Host;
    public serverInfo?: ServerInfo;

    private config: HostConfig;
    private client: Client;    
    private watchWorker?: WatchWorker;
    private workers: PriorityPool<PonyWorker>;
    
    constructor( host: Host ) {
        super();

        this.host = host;
        this.config = host.config;

        this.workers = new PriorityPool<PonyWorker>();

        this.client = new Client();
    }

    public async connect() {
        try {
            // Open SSH connection
            StatusTicker.showMessage( 'Connecting to ' + this.host.name + '...' );
            await this.openConnection();

            // Prepare worker script
            StatusTicker.showMessage( 'Initializing ' + this.host.name + '...' );
            await this.prepareWorkerScript();

            log.info( 'Opening workers' );

            // Open one primary worker.
            const channel = await this.startWorkerChannel();
            const worker = new PonyWorker( this, channel );

            // Start a secondary worker for Watching, grab server info. Can be done in parallel(ish)
            const promises: Promise<void>[] = [];
            promises.push( this.startWatcher() );
            promises.push( this.getServerInfo( worker ) );
            await Promise.all( promises );

            // Put primary worker into the pool
            this.addWorkerToPool( worker );

            // Kick off up to 5 additional workers. Don't wait on this process.
            void this.startSecondaryWorkers();

            log.info( 'Connected to ' + this.host.name );
            StatusTicker.showMessage( 'Connected to ' + this.host.name + '!' );
        } catch ( err ) {
            // If any part of connecting fails, clean up leftovers.
            StatusTicker.showMessage( 'Error connecting to ' + this.host.name + '!' );

            log.error( 'Error connecting to ' + this.host.name + ': ', err );
            this.emit( 'error', this, err );
            this.close();
            throw( err );
        }
    }

    private async prepareWorkerScript() {
        log.info( 'Preparing worker script' );

        // Verify worker script
        let workerScriptOk = await this.verifyWorkerScript();
        if ( ! workerScriptOk ) {
            await this.uploadWorkerScript();

            workerScriptOk = await this.verifyWorkerScript();
            if ( ! workerScriptOk ) {
                throw new Error( 'Hash mis-match after successfully uploading worker zip' );
            }
        }

        log.info( 'Worker script ok' );
    }

    private async getServerInfo( worker: PonyWorker ): Promise<void> {
        const rawServerInfo = await worker.getServerInfo();
        const rawHome = rawServerInfo.home as string;
        const home = rawHome + ( rawHome.endsWith( '/' ) ? '' : '/' );

        this.serverInfo = {
            home: home,
            cacheKey: rawServerInfo.cacheKey as string,
            newCacheKey: rawServerInfo.newCacheKey as boolean
        }; 

        log.info( 'Remote home directory: ', this.serverInfo.home );
    }

    public close() {
        // Roughly close my socket. This will cause all workers to fail.
        this.client.destroy();
    }

    public async expandPath( priority: number, remotePath: string ) {
        return await this.workerDo( priority, async ( worker: PonyWorker ) => {
            return await worker.expandPath( remotePath );
        } );
    }

    public async ls( priority: number, path: string ) {
        return await this.workerDo( priority, async ( worker: PonyWorker ) => {
            return await worker.ls( path );
        } );
    }

    public async readFile( priority: number, remotePath: string, cachedHash?: string ): Promise<Uint8Array | Symbol> {
        return await this.workerDo( priority, async ( worker: PonyWorker ) => {
            return await worker.readFile( remotePath, cachedHash );
        } );
    }

    public async writeFile( priority: number, remotePath: string, data: Uint8Array, options: { create: boolean, overwrite: boolean } ) {
        return await this.workerDo( priority, async ( worker: PonyWorker ) => {
            return await worker.writeFile( remotePath, data, options );
        } );
    }

    public async writeFileDiff( priority: number, remotePath: string, originalContent: Uint8Array, updatedContent: Uint8Array ) {
        return await this.workerDo( priority, async ( worker: PonyWorker ) => {
            return await worker.writeFileDiff( remotePath, originalContent, updatedContent );
        } );
    }

    public async rename( priority: number, fromPath: string, toPath: string, options: { overwrite: boolean } ) {
        return await this.workerDo( priority, async ( worker: PonyWorker ) => {
            return await worker.rename( fromPath, toPath, options );
        } );
    }

    public async delete( priority: number, remotePath: string ) {
        return await this.workerDo( priority, async ( worker: PonyWorker ) => {
            return await worker.delete( remotePath );
        } );
    }

    public async mkdir( priority: number, remotePath: string ) {
        return await this.workerDo( priority, async ( worker: PonyWorker ) => {
            return await worker.mkdir( remotePath );
        } );
    }

    public async addWatch( id: number, path: string, options: { recursive: boolean, excludes: string[] } ) {
        if ( this.watchWorker ) {
            await this.watchWorker.addWatch( id, path, options );
        }
    }

    public async rmWatch( id: number ) {
        if ( this.watchWorker ) {
            await this.watchWorker.rmWatch( id );
        }
    }

    public async workerDo( priority: number, fn: ( worker: PonyWorker ) => Promise<any> ) {
        let worker: PonyWorker | undefined = undefined;
        let result: any = undefined;

        try {
            worker = await this.workers.checkout( priority );
            result = await fn( worker );
        } catch ( err ) {
            throw( err );
        } finally {
            if ( worker !== undefined ) {
                this.workers.checkin( worker );
            }
        }

        return result;
    }

    private handleConnectionError( err: Error ) {
        log.error( 'Connection error: ', err );
        this.emit( 'error', this, err );
        this.close();
    }

    private async openConnection() {
        // Re-shape the HostConfig into an ssh2 config object.
        const sshConfig: ConnectConfig = Object.assign( {}, this.config ) as ConnectConfig;

        // If password is `true`, prompt for one.
        if ( this.config.password === true ) {
            sshConfig.password = await vscode.window.showInputBox( {
                password: true,
                prompt: 'Please enter your SSH password for ' + this.host.name + ':'
            } );
        }

        // If agent is `true`, or is `undefined` and no password is set, try to set a sensible default. 
        if ( this.config.agent === true || this.config.agent === undefined && ! this.config.password ) {
            sshConfig.agent = ( 'win32' === process.platform ? 'pageant' : process.env.SSH_AUTH_SOCK );
        }

        // Is the private key provided as a file? Load it.
        if ( this.config.privateKeyFile ) {
            const readFile = util.promisify( fs.readFile );
            sshConfig.privateKey = await readFile( expandHomeDir( this.config.privateKeyFile ), { 'encoding': 'latin1' } );
        }

        // Ask for a passphrase if none provided (and the key looks encrypted)
        if ( sshConfig.privateKey && ! sshConfig.passphrase && sshConfig.privateKey.includes( 'ENCRYPTED' ) ) {
            sshConfig.passphrase = await vscode.window.showInputBox( {
                password: true,
                prompt: 'Please enter your SSH key passphrase:',
            } );
        }

        // Set a debug callback if logging level is debug.
        if ( log.includesLevel( LoggingLevel.debug ) ) {
            sshConfig.debug = ( message: string ) => { log.debug( message ) };
        }

        return new Promise( async ( resolve, reject ) => {
            this.client.on( 'error', reject );

            this.client.on( 'ready', () => {
                this.client.removeListener( 'error', reject );
                this.client.on( 'error', this.handleConnectionError );

                log.info( 'Connection established' );
                resolve();
            } );

            log.info( 'Connecting to ' + this.host.name + ': ', sshConfig );
            this.client.connect( sshConfig );
        } );
    }
    
    private async verifyWorkerScript(): Promise<boolean> {
        return new Promise( ( resolve, reject ) => {
            log.debug( 'Verifying worker script' );
            const command = shellEscape( [ 'sh', '-c', pilotCommand ] );
            this.client.exec( command, ( err, channel ) => {
                if ( err ) {
                    return reject( err );
                }

                let buffer = '';
                channel.on( 'data', ( data: string ) => {
                    buffer += data;
                } );

                channel.stderr.on( 'data', ( data: string ) => {
                    log.debug( 'STDERR: ', data );
                } );

                channel.on( 'close', () => {
                    try {
                        const workerOk = this.parsePilotOutput( buffer );
                        log.debug( 'Worker script check result: ', workerOk );
                        resolve( workerOk );
                    } catch ( err ) {
                        reject( err );
                    }
                } );
            } );
        } );
    }

    private async parsePilotOutput( pilotOutput: string ) {
        const matches = pilotOutput.match( /\[ponyssh-marker ([hnp])(?: ([a-zA-Z0-9]+)(?:\s+.*)?)?\]/ );
        if ( ! matches ) {
            throw new Error( 'Invalid response from server' );
        }
        const [ , response, hash ] = matches;

        // If there's no python in the path, we're stuck.
        if ( 'p' === response ) {
            throw new Error( 'Remote host does not have Python installed' );
        }

        // Do we need to upload the Worker script?
        const workerScript = await WorkerScript.load();
        return ( 'h' === response && hash === workerScript.getHash() );
    }

    private pythonCommand() {
        if ( this.config.python ) {
            return this.config.python;
        } else {
            return 'python';
        }
    }

    private async uploadWorkerScript() {
        return new Promise( ( resolve, reject ) => {
            const pythonCommand = shellEscape( [ this.pythonCommand(), '-c', uploadCommand ] );
            const shellCommand = shellEscape( [ 'sh', '-c', pythonCommand ] );

            log.debug( 'Opening upload channel for worker script' );
            this.client.exec( shellCommand, async ( err, channel ) => {
                if ( err ) {
                    return reject( err );
                }

                channel.on( 'data', ( data: string ) => {
                    log.warn( 'STDOUT output during worker upload: ', data );
                } );

                let stderr = '';
                channel.stderr.on( 'data', ( data: string ) => {
                    stderr += data;
                    log.warn( 'STDERR output during worker upload: ', data );
                } );

                channel.on( 'close', ( code:  number ) => {
                    if ( 0 !== code ) {
                        reject( new Error( 'Error code ' + code + ' while uploading worker script. STDERR says: ' + stderr ) );
                    } else {
                        log.debug( 'Successfully uploaded worker script' );
                        resolve();
                    }
                } );

                // Send worker script up via STDIN.
                log.debug( 'Uploading worker script' );
                const workerScript = await WorkerScript.load();
                channel.stdin.write( workerScript.getData() );
                channel.stdin.end();
            } );
        } );
    }

    private async startWorkerChannel( args: string[] = [] ): Promise<Channel> {
        return new Promise<Channel>( ( resolve, reject ) => {
            const pythonCommand = shellEscape( [ this.pythonCommand() ] ) + ' ~/.pony-ssh/worker.zip ' + shellEscape( args );
            const shellCommand = shellEscape( [ 'sh', '-c', pythonCommand ] );

            this.client.exec( shellCommand, async ( err, channel ) => {
                if ( err ) {
                   return reject( err );
                }

                resolve( channel );
            } );
        } );
    }

    private onPoolWorkerError( worker: PonyWorker, err: Error ) {
        // For now: Treat all worker channel errors as connection errors.
        this.handleConnectionError( err );
    }

    private onWatchWorkerError( worker: PonyWorker, err: Error ) {
        if ( worker === this.watchWorker ) {
            this.watchWorker = undefined;
        }
    }

    private addWorkerToPool( worker: PonyWorker ) {
        worker.on( 'error', this.onPoolWorkerError.bind( this ) );
        this.workers.add( worker );
    }

    private async startSecondaryWorkers() {
        for ( let i = 0; i < 4; i++ ) {
            try {
                const channel = await this.startWorkerChannel();
                const worker = new PonyWorker( this, channel );
                this.addWorkerToPool( worker );
            } catch ( err ) {
                break;
            }
        }
    }

    private async startWatcher() {
        try {
            const channel = await this.startWorkerChannel( [ 'watcher' ] );
            this.watchWorker = new WatchWorker( this, channel );
            this.watchWorker.on( 'error', this.onWatchWorkerError );

            // If this is a reconnection, re-establish any active watches from the host.
            const watches = this.host.getActiveWatches();
            const promises = [];
            for ( const [ watchId, watch ] of Object.entries( watches ) ) {
                promises.push( this.addWatch( parseInt( watchId ), watch.path, watch.options ) );
            }
            await Promise.all( promises );
        } catch ( err ) {
            log.warn( 'Failed to open worker for watching file changes: ', err.message );
        }
    }

}