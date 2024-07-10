export function ensureError( err: unknown ): Error {
    if ( err instanceof Error ) {
        return err;
    }

    if ( typeof err === 'string' ) {
        return new Error( err );
    }

    return new Error( 'Unknown error' );
}
