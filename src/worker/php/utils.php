<?php

define( 'FILE_TYPE_FILE',      0x01 );
define( 'FILE_TYPE_DIRECTORY', 0x02 );
define( 'FILE_TYPE_SYMLINK',   0x03 );

function expand_user_path( $path ) {
	if ( strlen( $path ) > 0 && $path[0] === '~' ) {
		return home_path( substr( $path, 1 ) );
	} else {
		return $path;
	}
}

function get_home() {
	static $home = null;

	if ( $home === null ) {
		$home = getenv( 'HOME' );
		if ( empty( $home ) ) {
			$home = getcwd();
		}
	}
}

function home_path( $path = '' ) {
	$home_dir  = getenv( 'HOME' );
	if ( empty( $home_dir ) ) {
		$home_dir = getcwd();
	}

	$full_path = $home_dir . '/' . $path;

	if ( substr( $full_path, strlen( $full_path ) - 1 ) === '/' ) {
		return substr( $full_path, 0, strlen( $full_path ) - 1 );
	} else {
		return $full_path;
	}
}

function pony_path( $path = '' ) {
	return home_path( '.pony-ssh/' . $path );
}

/**
 * Get a cache key. Returns the cache key, and sets &$is_new to true if it's new.
 */
function get_cache_key( &$is_new = -1 ) {
	$cache_file_path   = pony_path( 'cache.key' );

	if ( is_file( $cache_file_path ) ) {
		$cache_key = file_get_contents( $cache_file_path, false, null, 0, 64 );
		if ( $cache_key && strlen( $cache_key ) === 64 ) {
			if ( $is_new !== -1 ) {
				$is_new = false;
			}

			return $cache_key;
		}
	}

	if ( $is_new !== -1 ) {
		$is_new = true;
	}

	$cache_key = bin2hex( random_bytes( 32 ) );
	file_put_contents( $cache_file_path, $cache_key );

	return $cache_key;
}

function process_stat( $stat ) {
	global $file_types;

	$mode      = $stat['mode'] & 0xF000;
	$file_type = FILE_TYPE_FILE;
	if ( $mode === 0x4000 ) {
		$file_type = FILE_TYPE_DIRECTORY;
	} else if ( $mode === 0x8000 ) {
		$file_type = FILE_TYPE_FILE;
	} else if ( $mode === 0xA000 ) {
		$file_type = FILE_TYPE_SYMLINK;
	}

	return [
		$file_type,
		$stat['mtime'],
		$stat['ctime'],
		$stat['size'],
	];
}

function trailingslashit( $str ) {
	if ( substr( $str, strlen( $str ) - 1 ) === '/' ) {
		return $str;
	} else {
		return $str . '/';
	}
}
