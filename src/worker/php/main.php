<?php



if ( count( $argv ) > 1 && $argv[1] === 'watcher' ) {
    run_watcher();
} else {
    run_worker();
}
