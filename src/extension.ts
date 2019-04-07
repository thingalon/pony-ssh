import * as vscode from 'vscode';
import { PonyFileSystem } from './PonyFileSystem';
import { StatusTicker } from './StatusTicker';

async function openRemoteFolder( ponyfs: PonyFileSystem, hostName: string, remotePath: string ) {
	const displayName = hostName + ':' + ( remotePath.startsWith( '/' ) ? '' : '/' ) + remotePath;

	try {
		// Ask the host to verify and expand the path (resolving ~/ if present)
		const host = await ponyfs.getActiveHost( hostName );
		const expandedPath = await host.expandPath( 1, remotePath );

		// Open the requested path, if valid.
		const fullPath = 'ponyssh:/' + hostName + ( expandedPath.startsWith( '/' ) ? '' : '/' ) + expandedPath;
		const newFolder = {
			name: displayName,
			uri: vscode.Uri.parse( fullPath ),
		};

		vscode.workspace.updateWorkspaceFolders( 0, 0, newFolder );
	} catch ( err ) {
		const retryAction = { title: 'Retry' };
		const cancelAction = { title: 'Cancel' };
		const message = 'Failed to open ' + displayName + ': ' + err.message;
		const response = await vscode.window.showErrorMessage( message, retryAction, cancelAction );

		if ( response === retryAction ) {
			await openRemoteFolder( ponyfs, hostName, remotePath );
		}
	}
}

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

		// Start connecting while we ask for a remote path. 
		( await ponyfs.getActiveHost( hostName ) ).getConnection();

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

		await openRemoteFolder( ponyfs, hostName, remotePath );
	} ) );
}
