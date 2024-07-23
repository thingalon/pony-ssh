import crypto = require( 'crypto' );
import fs = require( 'fs' );
import path = require( 'path' );

export class WorkerScript {

    private data: Buffer;
    private hash: string | undefined;

    private constructor( data: Buffer ) {
        this.data = data;
    }

    public getHash(): string {
        if ( ! this.hash ) {
            this.hash = crypto.createHash( 'md5' ).update( this.data ).digest( 'hex' );
        }

        return this.hash;
    }

    public getData(): Buffer {
        return this.data;
    }

    private static workerScriptPromise: { [ lang: string ]: Promise<WorkerScript> } = {};
    public static async load( lang: string ) {
        if ( ! this.workerScriptPromise[ lang ] ) {
            this.workerScriptPromise[ lang ] = new Promise( ( resolve, reject ) => {
                const scriptPath = path.join( __dirname, 'php' === lang ? 'worker.phar' : 'worker.zip' );
                // Load worker script
                fs.readFile( scriptPath, ( err, data ) => {
                    if ( err ) {
                        reject( err );
                    }

                    resolve( new WorkerScript( data ) );
                } );
            } );
        }

        return this.workerScriptPromise[ lang ];
    }

}