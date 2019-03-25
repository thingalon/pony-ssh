import * as vscode from 'vscode';
import { PonyFileSystem } from './PonyFileSystem';
import path = require( 'path' );

export function activate( context: vscode.ExtensionContext ) {
	const ponyfs = new PonyFileSystem( context );
	const provider = vscode.workspace.registerFileSystemProvider( 'ponyssh', ponyfs, { isCaseSensitive: true });
    context.subscriptions.push( provider );

	context.subscriptions.push( vscode.commands.registerCommand( 'ponyssh.openFolder', async _ => {
		const availableHosts = ponyfs.getAvailableHosts();
		const names = Object.keys( availableHosts );

		// Ask user to pick a host.
		const host = await vscode.window.showQuickPick( names, {
			placeHolder: 'Select a configured host',
		} );
		if ( ! host ) {
			return;
		}

		// Ask user to enter remote path
		let remotePath = await vscode.window.showInputBox( {
			placeHolder: 'Remote path. Default: ~/',
		} );
		if ( '' === remotePath ) {
			remotePath = '~';
		}
		if ( ! remotePath ) {
			return;
		}

		const fullPath = 'ponyssh:/' + host + ( remotePath.startsWith( '/' ) ? '' : '/' ) + remotePath;
		const name = host + ':' + ( remotePath.startsWith( '/' ) ? '' : '/' ) + remotePath;
		const newFolder = {
			name,
			uri: vscode.Uri.parse( fullPath ),
		};

        vscode.workspace.updateWorkspaceFolders( 0, 0, newFolder );
    } ) );
}
