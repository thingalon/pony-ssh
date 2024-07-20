import * as assert from 'assert';
import { ChildProcess, spawn } from 'child_process';
import { ChannelInterface, Opcode, PonyWorker } from '../PonyWorker';
import path from 'path';
import os from 'os';
import { mkdirp } from 'mkdirp';
// import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

class LocalWorker implements ChannelInterface {

	public static async start( command: string, args: string[] ) {
		const home = path.join( os.tmpdir(), `pony-ssh-test-${ Date.now() }` );
		await mkdirp( home );

		const env = { ...process.env, HOME: home };
		const worker = spawn( command, args, { env } );

		return new LocalWorker( worker, home );
	}

	private constructor( private readonly worker: ChildProcess, public readonly home: string ) {}

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

suite( 'Workers', () => {
	test( 'getinfo test', async () => {
		const localWorker = await LocalWorker.start( 'python3', [ 'out/worker.zip' ] );
		const worker = new PonyWorker( localWorker );

		const info = await worker.getServerInfo();

		assert.strictEqual( info.home, localWorker.home );
	} );
});
