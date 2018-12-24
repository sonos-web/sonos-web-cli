#!/usr/bin/env node
const program = require('commander');
const colors = require('colors');
const download = require('download-git-repo');
const shell = require('shelljs');
const ora = require('ora');
const fs = require('fs-extra');
const { version, name } = require('./package.json');

const configFileName = 'sonos-web-config.json';

const spinner = ora();

function asyncExec(command, logFile) {
  return new Promise((resolve, reject) => {
    shell.exec(command, { silent: true, async: false }, (code, stdout, stderr) => {
      if (logFile) {
        const stream = fs.createWriteStream(logFile, { flags: 'a' });
        stream.write(stdout);
        stream.write(stderr);
        stream.end();
      }
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

/**
 * Return the root path where this cli is installed
 */
async function getPackageRoot() {
  const path = await asyncExec('npm root -g');
  return `${path.trim()}/${name}`;
}

/**
 * Return the installation path of Sonos Web. Throws error if no installation was found.
 */
async function getInstallationPath() {
  try {
    const packagePath = await getPackageRoot();
    const { installDir } = fs.readJsonSync(`${packagePath}/${configFileName}`);
    return installDir;
  } catch (err) {
    throw err;
  }
}

/**
 * Start an existing installation of Sonos Web
 */
async function start() {
  try {
    spinner.start(`Starting ${colors.yellow('Sonos Web')}`);
    const installPath = await getInstallationPath();
    shell.cd(installPath);
    await asyncExec('forever start src/server.js');
    spinner.succeed();

    console.log('');
    logSuccess('Open a web browser to http://localhost:5050 to start!');
  } catch (err) {
    spinner.fail();
    logError(`no installation found...run ${colors.cyan('sonos-web install')} to get started`);
    shell.exit(1);
  }
}

async function stop() {
  try {
    spinner.start(`Stopping ${colors.yellow('Sonos Web')}`);
    const installPath = await getInstallationPath();
    shell.cd(installPath);
  } catch (err) {
    spinner.fail();
    logError('no installation found');
    shell.exit(1);
  }

  try {
    await asyncExec('forever stop src/server.js');
    spinner.succeed();
  } catch (err) {
    spinner.fail();
    logInfo(`${colors.yellow('Sonos Web')} isn't running`);
  }
}

async function uninstall() {
  console.log(`Uninstalling ${colors.yellow('Sonos Web')}`);
  let installPath = null;
  try {
    installPath = await getInstallationPath();
    shell.cd(installPath);
  } catch (err) {
    logError('no installation found');
    shell.exit(1);
  }

  // stop the server if it is running
  await stop();
  try {
    spinner.start('removing installation');
    // Remove config file
    const packagePath = await getPackageRoot();
    const configFilePath = `${packagePath}/${configFileName}`;
    await fs.remove(configFilePath);

    // Remove server files & directory
    await fs.remove(installPath);
    spinner.succeed();
    logSuccess(`${colors.yellow('Sonos Web')} uninstalled successfully`);
  } catch (err) {
    spinner.fail();
    logError('uninstall failed');
    shell.exit(1);
  }
}

async function install() {
  const installDir = `${process.cwd()}/sonos-web`;
  const logFile = `${installDir}/sonos-web-install.log`;

  console.log(`Installing ${colors.bold.yellow('Sonos Web')}`);

  try {
    const packagePath = await getPackageRoot();
    // Write the installation path for use in other cli commands
    fs.writeJson(`${packagePath}/${configFileName}`, { installDir });
  } catch (err) {
    logError(err);
    shell.exit(1);
  }

  spinner.start('downloading installation files');
  download('Villarrealized/sonos-web', installDir, async (err) => {
    // clear log file
    fs.writeFile(logFile, '');

    if (err) {
      fs.write(logFile, err);
      spinner.fail();
      shell.exit(1);
    }
    spinner.succeed();

    // Build Vue client server for production
    shell.cd(`${installDir}/client`);

    try {
      spinner.start('installing front-end dependencies');
      await asyncExec('npm install');
      spinner.succeed();

      spinner.start('build front-end application');
      await asyncExec('npm run build');
      spinner.succeed();

      spinner.start('install back-end dependencies');
      shell.cd(`${installDir}/server`);
      await asyncExec('npm install --only=production');
      await asyncExec('npm install forever -g');
      spinner.succeed();

      spinner.start('cleaning up installation files');
      shell.cd(installDir);
      // Move the dist folder created by `npm run build` in to the server folder
      shell.mv('client/dist', 'server');

      // clean up unnecessary files
      shell.mv('server/.env.production', 'server/.env');
      await fs.remove('.gitignore');
      await fs.remove('client');
      shell.cd(`${installDir}/server`);
      await fs.remove('package.json');
      await fs.remove('.eslintrc.js');
      await fs.remove('package-lock.json');
      shell.cd(installDir);
      shell.mv('server/*', '.');
      shell.mv('server/.*', '.');
      await fs.remove('server');
      spinner.succeed();

      // Start the Sonos Web server
      start();
    } catch (code) {
      spinner.fail();
      logError(`installation failed...check ${logFile} for more details`);
      shell.exit(1);
    }
  });
}


program
  .version(version)
  .description('CLI tool for installing Sonos Web'.cyan);

program
  .command('install')
  .description('Install Sonos Web to the current directory')
  .action(install);

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
