<?php

$parcel_types = [
	'HEADER'        => 0x01,
	'BODY'          => 0x02,
	'ERROR'         => 0x03,
	'ENDOFBODY'     => 0x04,

	'WARNING'       => 0x05,
	'CHANGE_NOTICE' => 0x06,
];

/**
 * Generator function that returns messages from stdin.
 */
function prepare_message_reader() {
	stream_set_blocking( STDIN, false );
	$buffer = '';

	while ( true ) {
		$read = [ STDIN ];
		$write = $except = NULL;

		// Wait for input.
		if ( stream_select( $read, $write, $except, 0, 200000 ) ) {
			$input = fread( STDIN, 1024 );
			if ( $input === false ) {
				break;
			}

			if ( $input !== '' ) {
				$buffer .= $input;
				if ( strlen( $buffer ) >= 10 ) {
					$cursor         = 0;
					$message_length = _msgpack_read( $buffer, $cursor );
					$message        = substr( $buffer, $cursor );

					if ( strlen( $message ) < $message_length ) {
						$message .= fread( STDIN, $message_length - strlen( $message ) );
					}

					error_log( 'Got message' );
					yield msgpack_read( $message );

					$buffer = substr( $message, $message_length );
				}
			}
		}
	}
}

/**
 * Send a response header
 */
function send_response_header( $response ) {
	global $parcel_types;

	$packed = msgpack_pack( (object) $response );
	send_parcel( $parcel_types['HEADER'], $packed );
	error_log( 'sent header' );
}

/**
 * Send a parcel
 */
function send_parcel( $parcel_type, $packed ) {
	$size = strlen( $packed );
	$data = chr( $parcel_type ) . msgpack_pack( $size ) . $packed;
	echo $data;
	flush();
}

/**
 * Send an error
 */
function send_error( $code, $message ) {
	global $parcel_types;

	send_parcel( $parcel_types['ERROR'], msgpack_pack( (object) [ 'code' => $code, 'error' => $message ] ) );
}

/**
 * Read a msgpack number from a stream carefully not to read too much.
 */
function fread_msgpack_number( $stream ) {
	$number = fgetc( $stream );
	if ( $number === false ) {
		throw new Exception( "Read failed." );
	}

	$read_size = [ 0xcc => 1, 0xcd => 2, 0xce => 4, 0xcf => 8 ][ ord( $number ) ] ?? 0;
	if ( $read_size > 0 ) {
		$next = fread( $stream, $read_size );
		if ( $next === false ) {
			throw new Exception( "Read failed." );
		}

		$number .= $next;
	}

	$result = msgpack_read( $number );
	if ( ! is_int( $result ) ) {
		throw new Exception( "Failed to read number." );
	}

	return $result;
}

/**
 * Read a value from msgpack data in $data and return it.
 * Convenience wrapper for _msgpack_read, which expects its parent to pass in a string.
 */
function msgpack_read( $data ) {
	$cursor = 0;
	return _msgpack_read( $data, $cursor );
}

/**
 * Pack a value into msgpack format and return it.
 */
function msgpack_pack( $value ) {
	if ( is_int( $value ) ) {
		if ( $value >= 0 ) {
			if ( $value <= 0x7f ) {
				return chr( $value );
			}

			if ( $value <= 0xff ) {
				return "\xcc" . chr( $value );
			}

			if ( $value <= 0xffff ) {
				return "\xcd" . pack( 'n', $value );
			}

			if ( $value <= 0xffffffff ) {
				return "\xce" . pack( 'N', $value );
			}

			return "\xcf" . pack( 'J', $value );
		}

		if ( $value >= -0x20 ) {
			return chr( $value + 0x100 );
		}

		if ( $value >= -0x80 ) {
			return "\xd0" . chr( $value + 0x100 );
		}

		if ( $value >= -0x8000 ) {
			return "\xd1" . pack( 'n', $value + 0x10000 );
		}

		if ( $value >= -0x80000000 ) {
			return "\xd2" . pack( 'N', $value + 0x100000000 );
		}

		return "\xd3" . pack( 'J', $value + 0x10000000000000000 );
	}

	if ( is_float( $value ) ) {
		return "\xcb" . pack( 'd', $value );
	}

	if ( is_string( $value ) ) {
		$length = strlen( $value );
		if ( $length <= 0x1f ) {
			return chr( 0xa0 + $length ) . $value;
		}

		if ( $length <= 0xff ) {
			return "\xd9" . chr( $length ) . $value;
		}

		if ( $length <= 0xffff ) {
			return "\xda" . pack( 'n', $length ) . $value;
		}

		return "\xdb" . pack( 'N', $length ) . $value;
	}

	if ( is_null( $value ) ) {
		return "\xc0";
	}

	if ( is_bool( $value ) ) {
		return $value ? "\xc3" : "\xc2";
	}

	if ( is_array( $value ) ) {
		$length = count( $value );
		if ( $length <= 0x0f ) {
			$result = chr( 0x90 + $length );
		} elseif ( $length <= 0xffff ) {
			$result = "\xdc" . pack( 'n', $length );
		} else {
			$result = "\xdd" . pack( 'N', $length );
		}

		foreach ( $value as $element ) {
			$result .= msgpack_pack( $element );
		}

		return $result;
	}

	if ( is_object( $value ) ) {
		$properties = get_object_vars( $value );
		$length = count( $properties );
		if ( $length <= 0x0f ) {
			$result = chr( 0x80 + $length );
		} elseif ( $length <= 0xffff ) {
			$result = "\xde" . pack( 'n', $length );
		} else {
			$result = "\xdf" . pack( 'N', $length );
		}

		foreach ( $properties as $key => $element ) {
			$result .= msgpack_pack( $key ) . msgpack_pack( $element );
		}

		return $result;
	}

	throw new Exception( "Unsupported type." );
}

/**
 * Internal function to read a value from msgpack data in $data and return it.
 * Always moves the cursor to the next byte after the read value.
 */
function _msgpack_read( $data, &$cursor ) {
	$first_byte = ord( $data[ $cursor ] );
	$cursor++;

	// 0x00 - 0x7f - fixnum.
	if ( $first_byte <= 0x7f ) {
		return $first_byte;
	}

	// 0xe0 - 0xff - negative fixnum.
	if ( $first_byte >= 0xe0 ) {
		return $first_byte - 0x100;
	}

	// 0x80 - 0x8f - fixmap.
	if ( $first_byte <= 0x8f ) {
		$length = $first_byte & 0x0f;
		return msgpack_read_map( $data, $cursor, $length );
	}

	// 0x90 - 0x9f - fixarray.
	if ( $first_byte <= 0x9f ) {
		$length = $first_byte & 0x0f;
		return msgpack_read_array( $data, $cursor, $length );
	}

	// 0xa0 - 0xbf - fixstr.
	if ( $first_byte <= 0xbf ) {
		$length = $first_byte & 0x1f;
		return msgpack_read_string( $data, $cursor, $length );
	}

	switch ( $first_byte ) {
		case 0xc0:  // nil
			return null;

		case 0xc2:  // false
			return false;

		case 0xc3:  // true
			return true;
		
		case 0xc4:  // bin8
			$length = ord( $data[ $cursor ] );
			$cursor++;

			return msgpack_read_string( $data, $cursor, $length );

		case 0xc5:  // bin16
			$length = msgpack_read_uint16( $data, $cursor );
			return msgpack_read_string( $data, $cursor, $length );
		
		case 0xc6:  // bin32
			$length = msgpack_read_uint32( $data, $cursor );
			return msgpack_read_string( $data, $cursor, $length );

		case 0xca:  // float32
			$number = unpack( 'f', substr( $data, $cursor, 4 ) )[1];
			$cursor += 4;
			return $number;

		case 0xcb:  // float64
			$number = unpack( 'd', substr( $data, $cursor, 8 ) )[1];
			$cursor += 8;
			return $number;

		case 0xcc:  // uint8
			return ord( $data[ $cursor++ ] );
		
		case 0xcd:  // uint16
			return msgpack_read_uint16( $data, $cursor );
		
		case 0xce:  // uint32
			return msgpack_read_uint32( $data, $cursor );
		
		case 0xcf:  // uint64
			return msgpack_read_uint64( $data, $cursor );

		case 0xd0:  // int8
			return ord( $data[ $cursor++ ] ) >= 0x80 ? ord( $data[ $cursor - 1 ] ) - 0x100 : ord( $data[ $cursor - 1 ] );
		
		case 0xd1:  // int16
			return msgpack_read_int16( $data, $cursor );
		
		case 0xd2:  // int32
			return msgpack_read_int32( $data, $cursor );
		
		case 0xd3:  // int64
			return msgpack_read_int64( $data, $cursor );

		case 0xd9:  // str8
			$length = ord( $data[ $cursor ] );
			$cursor += 1;

			return msgpack_read_string( $data, $cursor, $length );
		
		case 0xda:  // str16
			$length = msgpack_read_uint16( $data, $cursor );
			return msgpack_read_string( $data, $cursor, $length );
		
		case 0xdb:  // str32
			$length = msgpack_read_uint32( $data, $cursor );
			return msgpack_read_string( $data, $cursor, $length );
		
		case 0xdc:  // array16
			$length = msgpack_read_uint16( $data, $cursor );
			return msgpack_read_array( $data, $cursor, $length );
		
		case 0xdd:  // array32
			$length = msgpack_read_uint32( $data, $cursor );
			return msgpack_read_array( $data, $cursor, $length );
		
		case 0xde:  // map16
			$length = msgpack_read_uint16( $data, $cursor );
			return msgpack_read_map( $data, $cursor, $length );
		
		case 0xdf:  // map32
			$length = msgpack_read_uint32( $data, $cursor );
			return msgpack_read_map( $data, $cursor, $length );

		default:
			throw new Exception( "Unknown msgpack type 0x" . dechex( $first_byte ) );
	}
}

/**
 * Read a map from msgpack data in $data and return it.
 */
function msgpack_read_map( $data, &$cursor, $length ) {
	$result = [];

	for ( $i = 0; $i < $length; $i++ ) {
		$key = _msgpack_read( $data, $cursor );
		$value = _msgpack_read( $data, $cursor );
		$result[ $key ] = $value;
	}

	return $result;
}

/**
 * Read an array from msgpack data in $data and return it.
 */
function msgpack_read_array( $data, &$cursor, $length ) {
	$result = [];

	for ( $i = 0; $i < $length; $i++ ) {
		$result[] = _msgpack_read( $data, $cursor );
	}

	return $result;
}

/**
 * Read a string from msgpack data in $data and return it.
 */
function msgpack_read_string( $data, &$cursor, $length ) {
	$result = substr( $data, $cursor, $length );
	$cursor += $length;

	return $result;
}

/**
 * Read a uint16 from msgpack data in $data and return it.
 */
function msgpack_read_uint16( $data, &$cursor ) {
	$x = substr( $data, $cursor, 2 );
	$number = unpack( 'n', substr( $data, $cursor, 2 ) )[1];
	$cursor += 2;

	return $number;
}

/**
 * Read a uint32 from msgpack data in $data and return it.
 */
function msgpack_read_uint32( $data, &$cursor ) {
	$number = unpack( 'N', substr( $data, $cursor, 4 ) )[1];
	$cursor += 4;

	return $number;
}

/**
 * Read a uint64 from msgpack data in $data and return it.
 */
function msgpack_read_uint64( $data, &$cursor ) {
	$number = unpack( 'J', substr( $data, $cursor, 8 ) )[1];
	$cursor += 8;

	return $number;
}

/**
 * Read a int16 from msgpack data in $data and return it.
 */
function msgpack_read_int16( $data, &$cursor ) {
	$number = unpack( 'n', substr( $data, $cursor, 2 ) )[1];
	$number = $number >= 0x8000 ? $number - 0x10000 : $number; // Manually convert to signed.
	$cursor += 2;

	return $number;
}

/**
 * Read a int32 from msgpack data in $data and return it.
 */
function msgpack_read_int32( $data, &$cursor ) {
	$number = unpack( 'N', substr( $data, $cursor, 4 ) )[1];
	$number = $number >= 0x80000000 ? $number - 0x100000000 : $number; // Manually convert to signed.
	$cursor += 4;

	return $number;
}

/**
 * Read a int64 from msgpack data in $data and return it.
 */
function msgpack_read_int64( $data, &$cursor ) {
	$number = unpack( 'J', substr( $data, $cursor, 8 ) )[1];
	$number = $number >= 0x8000000000000000 ? $number - 0x10000000000000000 : $number; // Manually convert to signed.
	$cursor += 8;

	return $number;
}

