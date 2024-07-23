import path from 'path';
import { ChildProcess, spawn } from 'child_process';
import { mkdirp } from 'mkdirp';
import os from 'os';
import { ChannelInterface } from '../../PonyWorker';
import rimraf from 'rimraf';
import { randomBytes } from 'crypto';

export class LocalWorker implements ChannelInterface {

    public static cleanupList: string[] = [];

	public static async start( command: string, args: string[] ) {
		const home = path.join( os.tmpdir(), `pony-ssh-test-${ Date.now() }-${ randomBytes( 10 ).toString( 'hex' ) }` );
        LocalWorker.cleanupList.push( home );
		await mkdirp( home );

		const env = { ...process.env, HOME: home };
		const worker = spawn( command, args, { env } );

		return new LocalWorker( worker, home );
	}

	public static async startPython() {
		return LocalWorker.start( 'python3', [ 'out/worker.zip' ] )
	}

	public static async startPhp() {
		return LocalWorker.start( 'php', [ 'out/worker.phar' ] )
	}

    public static async cleanup() {
        for ( const dir of LocalWorker.cleanupList ) {
            await new Promise< void >( ( resolve, reject ) => {
                if ( dir.startsWith( os.tmpdir() ) ) {
                    rimraf( dir, ( err: any ) => {
                        if ( err ) {
                            reject( err );
                        } else {
                            resolve();
                        }
                    } );
                }
            } );
        }
    }

	private constructor( private readonly worker: ChildProcess, public readonly home: string ) {
        worker.stderr.on( 'data', ( data: Buffer ) => {
            console.log( data.toString() );
        } );
    }

	on( event: 'data',  listener: ( data: Buffer) => void    ): void;
	on( event: 'error', listener: ( error: Error) => void    ): void;
	on( event: 'end',   listener: () => void                 ): void;
	on( event: string,  listener: ( ...args: any[] ) => void ): void {
		this.worker.stdout.on( event, listener );
	}

	public get stderr() {
		return {
			on: ( event: 'data', listener: ( data: Buffer ) => void ) => {
				this.worker.stderr.on( event, listener );
			}
		};
	}

	write( data: Buffer ): void {
		this.worker.stdin.write( data );
	}

	close(): void {
		this.worker.kill();
	}

}