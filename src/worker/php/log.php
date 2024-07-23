<?php

const LOG_LEVEL_INFO = 1;
const LOG_LEVEL_WARN = 2;

function log_info( $message ) {
    _log( LOG_LEVEL_INFO, $message );
}


function log_warn( $message ) {
    _log( LOG_LEVEL_WARN, $message );
}

function _log( $level, $message ) {
    file_put_contents( pony_path( 'debug.log' ), date( 'Y-m-d H:i:s' ) . " [$level] $message\n", FILE_APPEND );
}
