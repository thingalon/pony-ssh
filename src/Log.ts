import * as vscode from 'vscode';
import util = require( 'util' );
import { HostConfig } from './Host';

export enum LoggingLevel {
    error = 0,
    warn = 1,
    info = 2,
    debug = 3,
}

const secretKeys = [ 'password', 'privateKey', 'passphrase' ];

class Log {

    private outputChannel: vscode.OutputChannel;
    private loggingLevel: LoggingLevel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel( 'Pony SSH Logs' );
        this.loggingLevel = LoggingLevel.info;
    }

    public initialize() {
        const config = vscode.workspace.getConfiguration( 'ponyssh' );
        if ( ! config || ! config.logging ) {
            return;
        }

        const levelName = config.logging.toLowerCase();
        const maybeLevel: LoggingLevel | undefined = (<any>LoggingLevel)[ levelName ];
        if ( maybeLevel ) {
            this.loggingLevel = maybeLevel;
        }
    }

    public show() {
        this.outputChannel.show( false );
    }

    public debug( ...messages: any[] ) {
        this.log( LoggingLevel.debug, ...messages );
    }

    public info( ...messages: any[] ) {
        this.log( LoggingLevel.info, ...messages );
    }

    public warn( ...messages: any[] ) {
        this.log( LoggingLevel.warn, ...messages );
    }

    public error( ...messages: any[] ) {
        this.log( LoggingLevel.error, ...messages );
    }

    public log( level: LoggingLevel, ...messages: any[] ) {
        if ( this.loggingLevel < level ) {
            return;
        }

        const timestamp = new Date().toISOString().substr( 0, 19 ).replace( 'T', ' ' );
        const levelName = LoggingLevel[ level ];
        this.outputChannel.append( `[${timestamp}] [${levelName}] ` );
        for ( const message of messages ) {
            if ( typeof( message ) === 'string' ) {
                this.outputChannel.append( message );
            } else if ( message instanceof Error && this.loggingLevel < LoggingLevel.debug ) {
                // Special case: don't include error stack traces unless logging level is debug
                this.outputChannel.append( message.message );
            } else if ( message instanceof Object && secretKeys.find( key => message.hasOwnProperty( key ) ) ) {
                this.outputChannel.append( util.inspect( this.stripSecrets( message ) ) );
            } else {
                this.outputChannel.append( util.inspect( message ) );
            }
        }
        this.outputChannel.appendLine( '' );
    }

    private stripSecrets( data: { [key: string]: any } ): Object {
        const clone: { [key: string]: any } = {};

        return Object.keys( data ).reduce( ( filtered, key: string ) => {
            if ( data[ key ] !== undefined ) {
                filtered[ key ] = secretKeys.includes( key ) ? '*****' : data[ key ];
            }

            return filtered;
        }, clone );
    }

}

export const log = new Log();
