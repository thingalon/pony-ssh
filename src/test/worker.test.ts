import * as assert from 'assert';
import { PonyWorker } from '../PonyWorker';
import { LocalWorker } from './lib/LocalWorker';
import { promises as fs } from 'fs';
// import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

suite( 'Workers', () => {

	suiteTeardown( async () => {
		await LocalWorker.cleanup();
	} );

	test( 'getinfo test', async () => {
		const localWorkers = await Promise.all( [ LocalWorker.startPython(), LocalWorker.startPhp() ] );

		for ( const lw of localWorkers ) {
			const worker = new PonyWorker( lw );
			const infoA  = await worker.getServerInfo();
			const infoB  = await worker.getServerInfo();
			
			assert.strictEqual( infoA.home, lw.home );
			assert.strictEqual( infoB.home, lw.home );

			assert.strictEqual( infoA.cacheKey, infoB.cacheKey );
			assert.strictEqual( typeof infoA.cacheKey, 'string' );
			assert.strictEqual( infoA.cacheKey.length, 64 );

			assert.strictEqual( infoA.newCacheKey, true );
			assert.strictEqual( infoB.newCacheKey, false );
		}
	} );

	test( 'ls test', async () => {
		const localWorkers = await Promise.all( [ LocalWorker.startPython(), LocalWorker.startPhp() ] );

		for ( const lw of localWorkers ) {
			const worker = new PonyWorker( lw );
			const result = await worker.ls( '~/' );

			assert.ok( Array.isArray( result.stat ), 'self stat should be an array' );
			assert.strictEqual( result.stat[0], 2 );

			assert.strictEqual( typeof result.dirs, 'object', 'dirs should be an object' );
			assert.strictEqual( Object.keys( result.dirs ).length, 2 );
			assert.strictEqual( typeof result.dirs['.'], 'object', 'dir . should be an object' );
			assert.ok( Array.isArray( result.dirs['.']['.pony-ssh'] ), '.lpony-ssh should be an array' );
			assert.strictEqual( result.dirs['.']['.pony-ssh'][0], 2 );
		}
	} );

	test( 'file read test', async () => {
		const localWorkers = await Promise.all( [ LocalWorker.startPython(), LocalWorker.startPhp() ] );

		for ( const lw of localWorkers ) {
			const worker  = new PonyWorker( lw );
			const content = 'Y HALLO THAR!!';
			await fs.writeFile( lw.home + '/my-file.txt', content );

			const read = await worker.readFile( '~/my-file.txt' );
			assert.ok( read instanceof Buffer );
			assert.ok( Buffer.from( content ).equals( read ) );
		}
	} );

	test( 'file write test', async () => {
		const localWorkers = await Promise.all( [ /*LocalWorker.startPython(),*/ LocalWorker.startPhp() ] );
		const documents = {
			short: 'Y HALLO THAR!!',
			long:  'long text is '.repeat( 2000 ),
		};

		for ( const lw of localWorkers ) {
			const worker  = new PonyWorker( lw );

			for ( const [ name, content ] of Object.entries( documents ) ) {
				const response = await worker.writeFile( '~/' + name + '.txt', Buffer.from( content ), { create: true, overwrite: false } );
				console.log( response );
				const read = await fs.readFile( lw.home + '/' + name + '.txt' );
				assert.ok( Buffer.from( content ).equals( read ) );
			}
		}
	} );

});
