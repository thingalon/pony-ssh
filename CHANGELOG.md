## [0.3.0] - 2019-12-18
### Fixed
- Ensure that errors that occur on the primary worker channel during connection are properly caught
- Ensure that STDERR outputs are in plaintext and untruncated

## [0.2.0] - 2019-11-23
### Added
- Allow users to configure custom shell to use when executing commands. Allows for `sudo` usage.

## [0.0.3] - 2019-09-17
### Fixed
- Properly clear stat cache when writing a file, avoiding unnecessary warnings about overwriting modified files.
- Update dependencies based on npm audit recommendations.

## [0.0.2] - 2019-04-25
### Fixed
- Don't try to clean up cache directories before they exist

## [0.0.1] - 2019-04-16
Initial Release. Features:

- Fast remote SSH editing
- Remote filesystem watching
- Encrypted local caching