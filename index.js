#!/usr/bin/env node
const program = require('commander');
const colors = require('colors');
const download = require('download-git-repo');
const shell = require('shelljs');
const ora = require('ora');
const fs = require('fs-extra');
const ip = require('ip');
const path = require('path');

const { version } = require('./package.json');

const spinner = ora();

/**
 * Returns the absolute installation path for Sonos Web
 */
function absoluteInstallPath() {
  shell.cd('~');
  const absolutePath = `${shell.pwd().stdout}/.sonos-web`;
  return absolutePath;
}

const foreverPath = `${path.dirname(require.resolve('forever/package.json'))}/bin/forever`;
const installPath = absoluteInstallPath();
const installLogFile = `${installPath}/install.log`;
const foreverLogFile = `${installPath}/forever.log`;
const logFile = `${installPath}/sonos-web.log`;
const pidFile = `${installPath}/sonos-web.pid`;


function asyncExec(command) {
  return new Promise((resolve, reject) => {
    shell.exec(command, { silent: true, async: false }, (code, stdout, stderr) => {
      const stream = fs.createWriteStream(installLogFile, { flags: 'a' });
      stream.write(stdout);
      stream.write(stderr);
      stream.end();
      if (code !== 0) {
        reject(code);
      } else {
        resolve(stdout);
      }
    });
  });
}

function logSuccess(description) {
  console.log(colors.bold.green('success ') + description);
}

function logError(description) {
  console.log(colors.bold.red('error ') + description);
}

function logInfo(description) {
  console.log(colors.bold.magenta('info ') + description);
}


function isInstalled() {
  return shell.test('-f', `${installPath}/src/server.js`);
}

/**
 * Start an existing installation of Sonos Web
 */
async function start() {
  const noPortErrorMessage = 'Could not find PORT environment variable';
  try {
    spinner.start(`Starting ${colors.yellow('Sonos Web')}`);
    if (!isInstalled()) throw new Error();
    shell.cd(installPath);

    const envFile = await fs.readFile('.env');
    const portEnv = envFile.toString().split('\n').find(env => env.includes('PORT='));
    if (!portEnv) {
      throw (new Error(noPortErrorMessage));
    }

    await asyncExec(`${foreverPath} --pidFile ${pidFile} -a -l ${foreverLogFile} -o ${logFile} -e ${logFile} start src/server.js`);
    spinner.succeed();

    // eslint-disable-next-line prefer-destructuring
    const port = portEnv.split('=')[1];
    const localIP = ip.address();
    const sonosNetworkAddress = `http://${localIP}:${port}`;

    console.log('');
    logSuccess(`Open a web browser on this computer to ${colors.cyan(`http://localhost:${port}`)} to start!`);
    console.log(`You can access ${colors.yellow('Sonos Web')} network-wide by going to ${colors.cyan(sonosNetworkAddress)}`);
  } catch (err) {
    spinner.fail();
    if (err.message === noPortErrorMessage) {
      logError(noPortErrorMessage);
    } else {
      logError(`no installation found...run ${colors.cyan('sonos-web install')} to get started`);
    }

    shell.exit(1);
  }
}

async function stop() {
  try {
    spinner.start(`Stopping ${colors.yellow('Sonos Web')}`);
    if (!isInstalled()) throw new Error();
    shell.cd(installPath);
  } catch (err) {
    spinner.fail();
    logError('no installation found');
    shell.exit(1);
  }

  try {
    await asyncExec(`${foreverPath} stop src/server.js`);
    spinner.succeed();
  } catch (err) {
    spinner.fail();
    logInfo(`${colors.yellow('Sonos Web')} isn't running`);
  }
}

async function uninstall() {
  console.log(`Uninstalling ${colors.yellow('Sonos Web')}`);
  // stop the server if it is running
  await stop();

  try {
    spinner.start('removing installation');
    // Remove server fiforeveles & directory
    fs.removeSync(installPath);
    spinner.succeed();
    logSuccess(`${colors.yellow('Sonos Web')} uninstalled successfully`);
  } catch (err) {
    spinner.fail();
    logError('uninstall failed');
    shell.exit(1);
  }
}

async function install() {
  if (isInstalled()) {
    console.log(`${colors.bold.yellow('Sonos Web')} is already installed`);
    console.log(`You may run ${colors.cyan('sonos-web update')} to remove the old installation and reinstall`);
    shell.exit(1);
  }

  console.log(`Installing ${colors.bold.yellow('Sonos Web')}`);
  if (shell.mkdir(installPath).code !== 0) {
    logError('Could not create install directory');
    shell.exit(1);
  }

  spinner.start('downloading installation files');
  download('Villarrealized/sonos-web', installPath, async (err) => {
    // clear log file
    fs.writeFile(installLogFile, '');

    if (err) {
      fs.write(installLogFile, err);
      spinner.fail();
      shell.exit(1);
    }
    spinner.succeed();
    // Build Vue client server for production
    shell.cd(`${installPath}/client`);

    try {
      spinner.start('installing front-end dependencies');
      await asyncExec('npm install');
      spinner.succeed();

      spinner.start('build front-end application');
      await asyncExec('npm run build');
      spinner.succeed();

      spinner.start('install back-end dependencies');
      shell.cd(`${installPath}/server`);
      await asyncExec('npm install --only=production');
      // await asyncExec('npm install forever -g');
      spinner.succeed();

      spinner.start('cleaning up installation files');
      shell.cd(installPath);
      // Move the dist folder created by `npm run build` in to the server folder
      shell.mv('client/dist', 'server');

      // clean up unnecessary files
      shell.mv('server/.env.production', 'server/.env');
      await fs.remove('.gitignore');
      await fs.remove('client');
      shell.cd(`${installPath}/server`);
      await fs.remove('package.json');
      await fs.remove('.eslintrc.js');
      await fs.remove('package-lock.json');
      shell.cd(installPath);
      shell.mv('server/*', '.');
      shell.mv('server/.*', '.');
      await fs.remove('server');
      spinner.succeed();

      // Start the Sonos Web server
      start();
    } catch (code) {
      spinner.fail();
      logError(`installation failed...check ${installLogFile} for more details`);
      shell.exit(1);
    }
  });
}

async function update() {
  await uninstall();
  await install();
}


program
  .version(version)
  .description('CLI tool for installing Sonos Web'.cyan);

program
  .command('install')
  .description('Install Sonos Web to your home directory')
  .action(install);

program
  .command('update')
  .description('Update Sonos Web to the latest version')
  .action(update);

program
  .command('start')
  .description('Start Sonos Web after it has been installed')
  .action(start);
program
  .command('stop')
  .description('Stop Sonos Web after it has been started')
  .action(stop);
program
  .command('uninstall')
  .action(uninstall)
  .description('Uninstall Sonos Web');

// Output help if no commands are given
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
// error on unknown commands
program.on('command:*', () => {
  console.logError(colors.red('Invalid command: %s\nSee --help for a list of available commands.'), program.args.join(' '));
  process.exit(1);
});

program.parse(process.argv);
