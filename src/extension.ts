import * as vscode from 'vscode';
import { PonyFileSystem } from './PonyFileSystem';
import { StatusTicker } from './StatusTicker';

export function activate( context: vscode.ExtensionContext ) {
	const ponyfs = new PonyFileSystem( context );
	const provider = vscode.workspace.registerFileSystemProvider( 'ponyssh', ponyfs, { isCaseSensitive: true });
    context.subscriptions.push( provider );

	StatusTicker.initialize();

	context.subscriptions.push( vscode.commands.registerCommand( 'ponyssh.openFolder', async _ => {
		const availableHosts = ponyfs.getAvailableHosts();
		const names = Object.keys( availableHosts );

		// Ask user to pick a host.
		const hostName = await vscode.window.showQuickPick( names, {
			placeHolder: 'Select a configured host',
		} );
		if ( ! hostName ) {
			return;
		}

		// Ask for remote path
		const defaultPath = availableHosts[ hostName ].path || '~';
		let remotePath = await vscode.window.showInputBox( {
			placeHolder: 'Remote path. Default: ' + defaultPath,
		} );
		if ( '' === remotePath ) {
			remotePath = defaultPath;
		}
		if ( ! remotePath ) {
			return;
		}

		// Open the requested path
		const leadingSlashPath = ( remotePath.startsWith( '/' ) ? '' : '/' ) + remotePath;
		const fullPath = 'ponyssh:/' + hostName + leadingSlashPath;
		const displayName = hostName + ':' + ( remotePath.startsWith( '~' ) ? remotePath : leadingSlashPath );

		const newFolder = {
			name: displayName,
			uri: vscode.Uri.parse( fullPath ),
		};

		vscode.workspace.updateWorkspaceFolders( 0, 0, newFolder );
	} ) );
}
