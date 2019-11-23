# Pony SSH

Pony SSH is a Visual Studio Code plugin which offers extremely fast file editing and remote filesystem watching via SSH.

## Features

Pony SSH makes editing files over SSH fast and painless. It features:

- **Blazingly fast** remote SSH editing
- Automatic remote **filesystem watching**; changes to your remote filesystem are reflected locally automatically
- **Encrypted local caching** for extremely fast and secure file access

## Requirements

Pony SSH requires an SSH server with Python >= 2.7 installed. Almost all Linux/Unix/OSX systems meet the requirements.

## Setup

Simply add a new `ponyssh.hosts` section to your `Settings.json` file, describing each remote system you would like to connect to. 

For example:
```
  "ponyssh.hosts": { 
    "my-host": {
       "host": "my-host.example.com",
       "username": "my-login",
       "password": "123456"
    },
    "another-host": {
       "host": "another-host.example.com",
       "username": "my-login",
       "agent": true
    }
  }
```

Each host can be configured with the following options: 
- `host` - **(Required)** Hostname or IP address to connect to.
- `username` - **(Required)** Username for authentication.
- `port` - Remote port to connect to. *Default: `22`*
- `path` - Default path to open when connecting to this host. *Default: `~` (home dir)*
- `password` - Specify your password, or set to `true` (without quotes) to prompt you for your password each time you connect.
- `agent` - Specify which SSH agent to use for connection, or enter `true` (without quotes) to use a sensible default. (see below)
- `privateKey` - Your private key for authentication.
- `privateKeyFile` - Specify a file containing your private key for authentication. eg: `~/.ssh/id_rsa`.
- `passphrase` - Enter a passphrase for decrypting your private key. If left blank, Pony SSH will prompt you for a passphrase if needed.
- `python` - Specify the full path to your python installation on your remote host. *Default: Your system default python installation*
- `shell` - Specify a shell to use when executing remote commands. Include any command line arguments needed to pass your shell a command to execute. Each command to execute will get appended to your shell string. eg: `sh -c` or `sudo sh -c`. *Default: `sh -c`*

### About SSH Agents

In most cases, you can set the `agent` field to `true`, and let Pony SSH pick a sensible default value for you. On Windows, Pony SSH will auto-select Pageant, and on Linux/Unix/OSX systems it will select `$SSH_AUTH_SOCK`.

You can manually configure Pony SSH to use Pageant on Windows by setting your `agent` to `pageant`. Alternately, you can specify the path to your SSH auth socket, or the environment variable in which your SSH auth socket can be found. eg: `/foo/bar/my-socket`, or `$SSH_AUTH_SOCK`.

### Example setups

Authentication using an SSH agent, opening `/var/www` by default:
```
 "ponyssh.hosts": { 
    "example-agent-auth": {
       "host": "example.com",
       "username": "my-login",
       "agent": true,
       "path": "/var/www"
    }
  }
```

Ask for a password each time you connect:
```
 "ponyssh.hosts": { 
    "example-password-ask": {
       "host": "example.com",
       "username": "my-login",
       "password": true
    }
  }
```

Load a private key from a file:
```
 "ponyssh.hosts": { 
    "example-private-key": {
       "host": "example.com",
       "username": "my-login",
       "privateKeyFile": "~/.ssh/my_key"
    }
  }
```

Connect to a host and use `sudo`:
```
 "ponyssh.hosts": {
    "example-sudo": {
       "host": "example.com",
       "username": "my-login",
       "agent": true,
       "shell": "sudo sh -c"
    }
  }
```
(Note: This setup assumes your user is allowed to sudo without a password)

## Usage

After adding a host to your `settings.json` file, Pony SSH is ready to use! To open a remote folder:

- Open the Command Palette (`⌘` + `shift` + `P` on OSX, or `Ctrl` + `shift` + `P` on Windows)
- Run the command "`Pony SSH: Open Remote Folder`"
- Select the remote host you would like to use (based on your configured list in `settings.json`)
- Enter the remote path you would like to enter, or leave it blank to open the default folder. 