import * as vscode from 'vscode';

export class StatusTicker {

    private static statusBarItem: vscode.StatusBarItem;
    private static currentTimeout?: NodeJS.Timeout;
    
    public static initialize() {
        this.statusBarItem = vscode.window.createStatusBarItem( vscode.StatusBarAlignment.Right, 1 );
    }

    public static showMessage( message: string ) {
        if ( this.currentTimeout ) {
            clearTimeout( this.currentTimeout );
        }

        this.statusBarItem.text = message;
        this.statusBarItem.show();

        this.currentTimeout = setTimeout( () => {
            this.currentTimeout = undefined;
            this.statusBarItem.hide();
        }, 5000 );
    }

}