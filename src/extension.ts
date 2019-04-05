import * as vscode from 'vscode';
import { PonyFileSystem } from './PonyFileSystem';

export function activate( context: vscode.ExtensionContext ) {
	const ponyfs = new PonyFileSystem( context );
	const provider = vscode.workspace.registerFileSystemProvider( 'ponyssh', ponyfs, { isCaseSensitive: true });
    context.subscriptions.push( provider );

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

		// Start connecting while we ask for a remote path. 
		const host = await ponyfs.getActiveHost( hostName );
		const connectPromise = host.connect();

		// Ask for remote host
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

		// Wait for the connection to finish and check the entered path.
		await connectPromise;
		const expandedPath = await host.expandPath( 1, remotePath );

		// Open the requested path, if valid.
		const fullPath = 'ponyssh:/' + hostName + ( expandedPath.startsWith( '/' ) ? '' : '/' ) + expandedPath;
		const name = hostName + ':' + ( remotePath.startsWith( '/' ) ? '' : '/' ) + remotePath;
		const newFolder = {
			name,
			uri: vscode.Uri.parse( fullPath ),
		};

        vscode.workspace.updateWorkspaceFolders( 0, 0, newFolder );
    } ) );
}
