import { HostConfig, Host } from "./Host";
import { Client, Channel} from 'ssh2';
import { WorkerScript } from "./WorkerScript";
import { PonyWorker } from "./PonyWorker";
import { PriorityPool } from "./PriorityPool";
import { WatchWorker } from "./WatchWorker";
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

interface ServerInfo {
    cacheKey: string;
    newCacheKey: boolean;
}

export class Connection {

    public host: Host;
    public serverInfo?: ServerInfo;

    private config: HostConfig;
    private client: Client;    
    private watchWorker?: WatchWorker;
    private workers: PriorityPool<PonyWorker>;
    
    constructor( host: Host ) {
        this.host = host;
        this.config = host.config;

        this.workers = new PriorityPool<PonyWorker>();
        
        this.client = new Client();
        this.client.on( 'error', this.handleConnectionError );
    }

    public async connect() {
        try {
            // Open SSH connection
            console.log( 'Opening SSH connection...' );
            await this.openConnection();

            // Prepare worker script
            console.log( 'Preparing worker script...' );
            await this.prepareWorkerScript();

            // Open one primary worker.
            console.log( 'Starting workers...' );
            const channel = await this.startWorkerChannel();
            const worker = new PonyWorker( this, channel );
            
            // Start a secondary worker for Watching, grab server info. Can be done in parallel(ish)
            const promises: Promise<void>[] = [];
            promises.push( this.startWatcher() );
            promises.push( this.getServerInfo( worker ) );
            await Promise.all( promises );

            // Put primary worker into the pool
            this.workers.add( worker );

            // Kick off up to 5 additional workers. Don't wait on this process.
            void this.startSecondaryWorkers();
        } catch ( err ) {
            // If any part of connecting fails, clean up leftovers.
            this.close();
            throw( err );
        }
    }

    private async prepareWorkerScript() {
        // Verify worker script
        let workerScriptOk = await this.verifyWorkerScript();
        if ( ! workerScriptOk ) {
            console.log( 'Uploading worker script...' );
            await this.uploadWorkerScript();

            workerScriptOk = await this.verifyWorkerScript();
            if ( ! workerScriptOk ) {
                throw new Error( 'Hash mis-match after successfully uploading worker zip' );
            }
        }
    }

    private async getServerInfo( worker: PonyWorker ): Promise<void> {
        const rawServerInfo = await worker.getServerInfo();

        this.serverInfo = {
            cacheKey: rawServerInfo.cacheKey as string,
            newCacheKey: rawServerInfo.newCacheKey as boolean
        };  
    }

    public close() {
        // TODO: Clean up the connection here.
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
        // TODO: Should we emit an error or something?
        console.error( err );
        console.warn( 'handleConnectionError called but not yet implemented!' );
        this.close();
    }

    private async openConnection() {
        return new Promise( ( resolve, reject ) => {
            this.client.on( 'error', reject );

            this.client.on( 'ready', () => {
                this.client.removeListener( 'error', reject );
                resolve();
            } );

            this.client.connect( this.config );
        } );
    }
    
    private async verifyWorkerScript() {
        return new Promise( ( resolve, reject ) => {
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
                    console.log( 'STDERR: ' + data );
                } );

                channel.on( 'close', () => {
                    try {
                        resolve( this.parsePilotOutput( buffer ) );
                    } catch ( err ) {
                        reject( err );
                    }
                } );
            } );
        } );
    }

    private async parsePilotOutput( pilotOutput: string ) {
        const matches = pilotOutput.match( /\[ponyssh-marker ([hnp])(?: ([a-zA-Z0-9]+)\s+.*)?\]/ );
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

    private async uploadWorkerScript() {
        return new Promise( ( resolve, reject ) => {
            const pythonCommand = shellEscape( [ 'python', '-c', uploadCommand ] );
            const shellCommand = shellEscape( [ 'sh', '-c', pythonCommand ] );

            this.client.exec( shellCommand, async ( err, channel ) => {
                if ( err ) {
                    return reject( err );
                }

                channel.on( 'data', ( data: string ) => {
                    console.log( 'STDOUT during upload: ' + data );
                } );

                let stderr = '';
                channel.stderr.on( 'data', ( data: string ) => {
                    stderr += data;
                    console.log( 'STDERR during upload: ' + data );
                } );

                channel.on( 'close', ( code:  number ) => {
                    if ( 0 !== code ) {
                        reject( new Error( 'Error code ' + code + ' while uploading worker script. STDERR says: ' + stderr ) );
                    } else {
                        resolve();
                    }
                } );

                // Send worker script up via STDIN.
                const workerScript = await WorkerScript.load();
                channel.stdin.write( workerScript.getData() );
                channel.stdin.end();
            } );
        } );
    }

    private async startWorkerChannel( args: string[] = [] ): Promise<Channel> {
        return new Promise<Channel>( ( resolve, reject ) => {
            const pythonCommand = 'python ~/.pony-ssh/worker.zip ' + shellEscape( args );
            const shellCommand = shellEscape( [ 'sh', '-c', pythonCommand ] );

            this.client.exec( shellCommand, async ( err, channel ) => {
                if ( err ) {
                   return reject( err );
                }

                resolve( channel );
            } );
        } );
    }

    private async startSecondaryWorkers() {
        for ( let i = 0; i < 4; i++ ) {
            try {
                const channel = await this.startWorkerChannel();
                const worker = new PonyWorker( this, channel );
                this.workers.add( worker );
            } catch ( err ) {
                break;
            }
        }
    }

    private async startWatcher() {
        try {
            const channel = await this.startWorkerChannel( [ 'watcher' ] );
            this.watchWorker = new WatchWorker( this, channel );
            console.log( 'Started watchWorker' );
        } catch ( err ) {
            console.warn( 'Failed to open worker for watching file changes: ' + err.message );
        }
    }

}