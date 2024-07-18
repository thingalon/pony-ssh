import * as assert from 'assert';
import { ChildProcess, spawn } from 'child_process';
import msgpack from 'msgpack-lite';
import { Opcode } from '../PonyWorker';
// import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

class WorkerProcess {

	/*private buffer: Buffer = Buffer.alloc( 0 );

	public static start( command: string, args: string[] ) {
		const worker = spawn( command, args );
		return new WorkerProcess( worker );
	}

	private constructor( private readonly worker: ChildProcess ) {
		this.worker.stdout.on( 'data', this.onStdOut.bind( this ) );
		this.worker.stderr.on( 'data', this.onStdErr.bind( this ) );
		this.worker.on( 'close', this.onClose.bind( this ) );
	}

	private onStdOut( data: Buffer ) {
		this.buffer = Buffer.concat( [ this.buffer, data ] );
		const [ message, rest ] = msgpack.decode( this.buffer, true );

		console.log( data.toString() );
	}

	private onStdErr( data: Buffer ) {
		console.log( data.toString() );
	}

	private onClose( code: number ) {
		console.log( `child process exited with code ${code}` );
	}*/

}

suite( 'Workers', () => {
	test( 'getinfo test', () => {
		const command = 'python3';
        const args = [ __dirname + '/../../out/worker.zip' ];

        const worker = spawn( command, args );
		worker.stdout.on( 'data', ( data ) => {
			console.log( data.toString() );
		} );
		worker.stderr.on( 'data', ( data ) => {
			console.log( data.toString() );
		} );
		worker.on( 'close', ( code ) => {
			console.log( `child process exited with code ${code}` );
		} );

		worker.stdin.write( msgpack.encode( [ Opcode.GET_SERVER_INFO, {} ] ) );

		assert.ok( true );
	} );
});
