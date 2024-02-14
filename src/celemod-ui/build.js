const { Parcel } = require('@parcel/core');
const { join } = require('path');
const { fileURLToPath } = require('url');

let bundler = new Parcel({
    entries: './src/index.html',
    defaultConfig: '@parcel/config-default',
    serveOptions: {
        port: 1234
    },
    hmrOptions: {
        port: 1234
    },
    shouldAutoInstall: true,
    mode: process.argv.includes('--prod') ? 'production' : 'development',
    defaultTargetOptions: {
        engines: {
            browsers: ["Chrome 10"],
        },
    },
    additionalReporters: [
        {
            packageName: "@parcel/reporter-cli",
            resolveFrom: __dirname,
        },
    ],
    watchDir: join(__dirname, 'src'),
});

const postBuildAction = () => {
    // read ./dist/index.html
    const fs = require('fs');
    let html = fs.readFileSync('./dist/index.html', 'utf8');
    // make <link> tag into <style src="..." />
    html = html.replace(/<link rel="stylesheet" href="(.+?)">/g, '<style src="$1"/>');
    // write ./dist/index.html
    fs.writeFileSync('./dist/index.html', html, 'utf8');

    const files = fs.readdirSync('./dist');
    for (const file of files) {
        if (file.endsWith('.css')) {
            let css = fs.readFileSync(`./dist/${file}`, 'utf8');
            css = css.replace(/! important/g, ' !important');
            fs.writeFileSync(`./dist/${file}`, css, 'utf8');
        }

        if (file.endsWith('.js')) {
            let js = fs.readFileSync(`./dist/${file}`, 'utf8');
            js = js.replace(/window.dispatchEvent/g, 'console.log');

            for (const fileName of files) {
                js = js.replaceAll(`${JSON.stringify(fileName + "?")}+Date.now()`, JSON.stringify(fileName))
                js = js.replaceAll(`${JSON.stringify(fileName)} + "?" + Date.now()`, JSON.stringify(fileName))
            }

            fs.writeFileSync(`./dist/${file}`, js, 'utf8');
        }

        if (file.endsWith('.map')) {
            fs.rmSync(`./dist/${file}`);
        }

        if (file.endsWith('.html')) {
            let html = fs.readFileSync(`./dist/${file}`, 'utf8');
            const sciterSpecific = fs.readFileSync('./src/sciter-specific.js', 'utf-8');
            html = html.replace(`padding("padding for sciter-specific.js")`,
                `</script><script type="module">${sciterSpecific}`
            );
            fs.writeFileSync(`./dist/${file}`, html, 'utf8');
        }
    }

    console.log('- Post-build actions complete, bundling');

    const process = require('child_process');
    process.execSync(`${join(__dirname, '../../sciter/packfolder.exe')} ./dist ${join(__dirname, '../../resources/dist.rc')} -binary`, { stdio: 'inherit' });

    console.log('🚀Bundling complete, packed into resources/dist.rc')
}

!(async () => {
    if (process.argv.includes('--prod')) {
        const fs = require('fs');
        fs.rmdirSync('./dist', { recursive: true });
        await bundler.watch((err, evt) => {
        
            // console.clear()
            if (evt.type === 'buildSuccess') {
                postBuildAction()
                process.exit(0);
            } else {
                console.log('⚠️Build error', err, evt);
            }
        });
    } else {
        await bundler.watch((err, evt) => {
            // console.clear()
            if (evt.type === 'buildSuccess') {
                postBuildAction()
            } else {
                console.log('⚠️Build error', err, evt);
            }
        });
    }
})();