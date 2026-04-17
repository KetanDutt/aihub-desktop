const fs = require('fs');

let code = fs.readFileSync('src/updater.js', 'utf8');

// Replace dialog.showMessageBox with Notification
const replacement = `
    autoUpdater.on('update-downloaded', (info) => {
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
`;

code = code.replace(/autoUpdater\.on\('update-downloaded', \(info\) => \{[\s\S]*?\}\);/, replacement.trim());

fs.writeFileSync('src/updater.js', code);
