<?php

require_once __DIR__ . '/handlers.php';
require_once __DIR__ . '/log.php';
require_once __DIR__ . '/protocol.php';
require_once __DIR__ . '/utils.php';

// Make sure ~/.pony-ssh dir exists.
if ( ! is_dir( pony_path() ) ) {
	if ( ! mkdir( pony_path() ) ) {
		echo "Failed to create " . pony_path() . " directory.\n";
		die;
	}
}

function run_worker() {
	$reader = prepare_message_reader();
	foreach ( $reader as $message ) {
		try {
			if ( ! is_array( $message ) || count( $message ) !== 2 ) {
				log_info( "Invalid message received." );
				continue;
			}

			list( $opcode, $args ) = $message;
			error_log( 'Got opcode ' . $opcode );
			handle_message( $opcode, $args );
		} catch ( Exception $e ) {
			send_error( 22, $e->getMessage() );
		}
	}
}

if ( count( $argv ) > 1 && $argv[1] === 'watcher' ) {
	echo "Watcher not implemented.\n";
	die;
} else {
	run_worker();
}
