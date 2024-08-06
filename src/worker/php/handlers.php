<?php

$handlers = [
	0x01 => 'handle_ls',
	0x02 => 'handle_getinfo',
	0x03 => 'handle_read_file',
	0x04 => 'handle_write_file',
	0x05 => 'handle_mkdir',
	0x06 => 'handle_delete',
	0x07 => 'handle_rename',
	0x08 => 'handle_expand_path',
	0x09 => 'handle_write_diff',
];

define( 'DIFF_UNCHANGED', 0x00 );
define( 'DIFF_INSERTED',  0x01 );
define( 'DIFF_REMOVED',   0x02 );

function safe_define( $symbol, $value ) {
	if ( ! defined( $symbol ) ) {
		define( $symbol, $value );
	}
}

safe_define( 'ENOENT', 2  );
safe_define( 'EIO',    5  );
safe_define( 'EACCES', 13 );
safe_define( 'EEXIST', 17 );
safe_define( 'EISDIR', 21 );
safe_define( 'EINVAL', 22 );

function handle_message( $opcode, $args ) {
	global $handlers;

	if ( ! array_key_exists( $opcode, $handlers ) ) {
		log_info( "Invalid opcode received." );
		return;
	}

	$handlers[ $opcode ]( $args );
}

function handle_getinfo( $args ) {
	$cache_key = get_cache_key( $is_new );

	send_response_header( (object) [
		'home'        => home_path( '' ),
		'cacheKey'    => $cache_key,
		'newCacheKey' => $is_new,
	] );
}

function handle_ls( $args ) {
	$base = expand_user_path( $args['path'] );

	$self_stat = @stat( $base );
	if ( $self_stat === false ) {
		throw new Exception( 'File not found: ' . $base );
	}

	$processed_self = process_stat( $self_stat );
	$result         = (object) [ 'stat' => $processed_self ];

	if ( $processed_self[0] !== FILE_TYPE_DIRECTORY ) {
		send_response_header( $result );
		return;
	}

	$dirs        = [];
	$dir_limit   = 25;
	$entry_limit = 2000;
	$explore     = [ '.' ];
	while ( count( $explore ) > 0 && $dir_limit > 0 && $entry_limit > 0 ) {
		$dir_limit -= 1;

		$rel_path = array_shift( $explore );
		$abs_path = $rel_path === '.' ? $base : trailingslashit( $base ) . $rel_path;

		try {
			$children = [];
			foreach ( scandir( $abs_path ) as $child_name ) {
				if ( $child_name === '.' || $child_name === '..' ) {
					continue;
				}

				$entry_limit -= 1;
				if ( $entry_limit < 0 && count( $dirs ) > 0 ) {
					$children = null;
					break;
				}

				$child_path = trailingslashit( $abs_path ) . $child_name;
				try {
					$child_stat = stat( $child_path );
					$children[ $child_name ] = process_stat( $child_stat );
					if ( $children[ $child_name ][0] === FILE_TYPE_DIRECTORY ) {
						array_push( $explore, trailingslashit( $rel_path ) . $child_name );
					}
				} catch ( Exception $e ) {
					log_warn( "Skipping $child_name: ". $e->getMessage() );
				}
			}

			if ( $children !== null ) {
				$dirs[ $rel_path ] = (object) $children;
			}
		} catch ( Exception $e ) {
			log_warn( "Error: " . $e->getMessage() );
			if ( count( $dirs ) === 0 ) {
				throw $e;
			}
		}
	}

	$result->dirs = (object) $dirs;
	send_response_header( $result );
}

function handle_read_file( $args ) {
	global $parcel_types;

	$path = expand_user_path( $args['path'] );

	if ( ! file_exists( $path ) ) {
		send_error( 2, 'Path not found' );
		return;
	} else if ( ! is_file( $path ) ) {
		send_error( 21, 'Not a file' );
		return;
	}

	// If a hash has been supplied, check if it matches. If so, shortcut download...
	if ( isset( $args['cachedHash'] ) ) {
		$hash = md5_file( $path );
		if ( $hash === $args['cachedHash'] ) {
			send_response_header( (object) [ 'hashMatch' => true ] );
			return;
		}
	}

	// Open the file before sending a response header.
	$fh   = fopen( $path, 'rb' );
	$size = filesize( $path );

	if ( false === $size || ! $fh ) {
		throw new Exception( 'Failed to open file ' . $path );
	}

	send_response_header( (object) [ 'length' => $size ] );
	if ( $size === 0 ) {
		return;
	}

	$chunk_size = 200 * 1024;
	while ( true ) {
		$chunk = fread( $fh, $chunk_size );
		if ( ! $chunk ) {
			break;
		}

		send_parcel( $parcel_types['BODY'], $chunk );
	}

	fclose( $fh );

	send_parcel( $parcel_types['ENDOFBODY'], '' );
}

function handle_write_file( $args ) {
	$path = expand_user_path( $args['path'] );

	$exists = file_exists( $path );
	if ( $exists && ! $args['overwrite'] ) {
		send_error( EEXIST, 'File already exists' );
		return;
	} else if ( ! $exists && ! $args['create'] ) {
		send_error( ENOENT, 'File not found ' . json_encode( $args ) );
		return;
	}

	$result = file_put_contents( $path, $args['data'] );
	if ( false === $result ) {
		send_error( EACCES, 'Access denied' );
		return;
	}

    send_response_header( [] );
}

function handle_mkdir( $args ) {
	$path = expand_user_path( $args['path'] );

	$result = @mkdir( $path );
	if ( ! $result ) {
		send_error( EACCES, 'Access denied' );
		return;
	}

    send_response_header( [] );
}

function handle_delete( $args ) {
	$path = expand_user_path( $args['path'] );

	/** @todo once this is more stable, allow tree deletes. */

	$result = @unlink( $path );
	if ( ! $result ) {
		send_error( EACCES, 'Access denied' );
		return;
	}

	send_response_header( [] );
}

function handle_rename( $args ) {
	$from = expand_user_path( $args['from'] );
	$to   = expand_user_path( $args['to'] );

	if ( file_exists( $to ) ) {
		if ( $args['overwrite'] ) {
			if ( ! @unlink( $to ) ) {
				send_error( EACCES, 'Access denied' );
				return;
			}
		} else {
			send_error( EEXIST, 'File already exists' );
		}
	}

	@rename( $from, $to );

	send_response_header( [] );
}

function handle_expand_path( $args ) {
	$path = expand_user_path( $args['path'] );
	if ( ! file_exists( $path ) ) {
		send_error( 2, 'Path not found' );
	} else if ( ! is_dir( $path ) ) {
		send_error( 20, 'Not a directory' );
	} else {
		send_response_header( [ 'path' => $path ] );
	}
}

function handle_write_diff( $args ) {
	$path = expand_user_path( $args['path'] );

	if ( ! file_exists( $path ) ) {
		send_error( ENOENT, 'File not found' );
		return;
	}

	$original_data = file_get_contents( $path );
	if ( $original_data === false ) {
		send_error( EACCES, 'Access denied' );
		return;
	}

	$original_hash = md5( $original_data );
	if ( $original_hash !== $args['hashBefore'] ) {
		send_error( EIO, 'File hash does not match client cached value: ' . $args['hashBefore'] . ' vs ' . $original_hash );
		return;
	}

	// Apply diff. Array of [ type, args, type, args ].
	$updated_data = '';
	$read_cursor  = 0;
	$diff         = $args['diff'];

	for ( $i = 0; $i < count( $diff ); $i += 2 ) {
		$action      = $diff[ $i ];
		$action_data = $diff[ $i + 1 ];

		switch ( $action ) {
			case DIFF_INSERTED:
				$updated_data .= $action_data;
				break;

			case DIFF_REMOVED:
				$read_cursor += $action_data;
				break;
			
			default:
				$updated_data .= substr( $original_data, $read_cursor, $action_data );
				$read_cursor  += $action_data;
				break;
		}
	}

	// Check the hash after the diff update.
	$updated_hash = md5( $updated_data );
	if ( $updated_hash !== $args['hashAfter'] ) {
		send_error( EINVAL, 'File hash after changes applied does not match expected' );
		return;
	}

	// Write the update.
	if ( ! @file_put_contents( $path, $updated_data ) ) {
		send_error( EACCES, 'Access denied: ' . $path );
		return;
	}

	send_response_header( [] );
}
