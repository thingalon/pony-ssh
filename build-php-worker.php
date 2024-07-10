<?php

$phar = new Phar( __DIR__ . '/out/worker.phar' );
$phar->buildFromDirectory( __DIR__ . '/src/worker/php/' );
$phar->setStub( $phar->createDefaultStub( 'main.php' ) );
$phar->compressFiles( Phar::GZ );
