import * as vscode from 'vscode';
import { PonyWorker, ParcelType, Opcode } from "./PonyWorker";
import { decode as msgpackDecode } from "msgpack-lite";
import { Connection } from "./Connection";
import { Channel } from "ssh2";

enum ChangeType {
    CHANGED = 0x01,
    CREATED = 0x02,
    DELETED = 0x03
};

export class WatchWorker extends PonyWorker {

    constructor( connection: Connection, channel: Channel ) {
        super( connection, channel );
    }

    protected onParcel( type: ParcelType, body: Buffer ) {
        try {
            switch ( type ) {
                case ParcelType.CHANGE_NOTICE:
                    this.handleChangeNotice( msgpackDecode( body ) as { [watchId: number]: { [path: string]: ChangeType } } );
                    break;

                case ParcelType.WARNING:
                    this.handleWarning( body.toString() );
                    break;
                
                default:
                    this.handleWarning( 'Invalid parcel type received by Watch Worker: ' + type );
                    break;
            }
        } catch ( err ) {
            // TODO: Handle this properly.
            console.warn( 'Error while parsing Watcher parcel: ' + err );   
        }
    }

    public async addWatch( id: number, path: string, options: { recursive: boolean, excludes: string[] } ) {
        this.sendMessage( Opcode.ADD_WATCH, {
            'id': id,
            'path': path,
            'recursive': options.recursive,
            'excludes': options.excludes
         } );
    }

    public async rmWatch( id: number ) {
        this.sendMessage( Opcode.REMOVE_WATCH, { 'id': id } );
    }

    private processChangeType( changeType: ChangeType ): vscode.FileChangeType {
        switch ( changeType ) {
            case ChangeType.CHANGED:
                return vscode.FileChangeType.Changed;

            case ChangeType.CREATED:
                return vscode.FileChangeType.Created;

            case ChangeType.DELETED:
                return vscode.FileChangeType.Deleted;
        }
    }

    private handleChangeNotice( changes: { [watchId: number]: { [path: string]: ChangeType } } ) {
        for ( const watchIdKey in changes ) {
            const watchId: number = parseInt( watchIdKey );
            for ( const path in changes[ watchIdKey ] ) {
                const changeType = changes[ watchIdKey ][ path ];
                this.connection.host.handleChangeNotice( watchId, path, this.processChangeType( changeType ) );
            }
        }
    }

    private handleWarning( message: string ) {
        vscode.window.showWarningMessage( message, { modal: false } );
    }

}
