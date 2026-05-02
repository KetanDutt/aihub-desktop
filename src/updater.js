const log = require('electron-log');
const { dialog } = require('electron');

function setupAutoUpdater() {
    const { autoUpdater } = require('electron-updater');

    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = 'info';

    autoUpdater.on('checking-for-update', () => {
        log.info('Checking for update...');
    });

    autoUpdater.on('update-available', () => {
        log.info('Update available.');
        dialog.showMessageBox({
            type: 'info',
            title: 'Update Available',
            message: 'A new version of AI Hub Desktop is available. Downloading now...'
        });
    });

    autoUpdater.on('update-not-available', () => {
        log.info('Update not available.');
    });

    autoUpdater.on('error', (err) => {
        log.error('Error in auto-updater. ' + err);
    });

    autoUpdater.on('update-downloaded', () => {
        log.info('Update downloaded');
        const { Notification } = require('electron');

        if (Notification.isSupported()) {
            const notification = new Notification({
                title: 'Update Ready',
                body: 'A new version of AI Hub Desktop is ready. Click to restart and install.'
            });
            notification.on('click', () => {
                autoUpdater.quitAndInstall();
            });
            notification.show();
        } else {
            // Fallback
            dialog.showMessageBox({
                type: 'info',
                title: 'Update Ready',
                message: 'Install and restart now?',
                buttons: ['Restart', 'Later']
            }).then((result) => {
                if (result.response === 0) {
                    autoUpdater.quitAndInstall();
                }
            });
        }
    });

    // We can wrap this in a try-catch for cases where no valid update config is set (e.g. dev environment).
    try {
        autoUpdater.checkForUpdatesAndNotify();
    } catch (e) {
        log.error('Failed to check for updates: ' + e);
    }
}

module.exports = {
    setupAutoUpdater
};
