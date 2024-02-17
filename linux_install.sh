#!/bin/bash
mkdir -p /usr/lib/sciter
wget https://gitlab.com/sciter-engine/sciter-js-sdk/-/raw/main/bin/linux/x64/libsciter.so?ref_type=heads -O /usr/lib/sciter/libsciter-gtk-64.so

touch /etc/ld.so.conf.d/sciter.conf
bash -c 'echo "/usr/lib/sciter" > /etc/ld.so.conf.d/sciter.conf'
ldconfig

if ldconfig -p | grep libsciter > /dev/null; then
    echo "SUCCESS: Sciter shared library installed"
else
    echo "FAILED: Sciter shared library NOT installed"
fi