FROM alpine:edge
MAINTAINER Koki Takahashi <hakatasiloving@gmail.com>

RUN apk update && \
    apk upgrade && \
    apk add texlive zip imagemagick python3 make texinfo texlive-dvi optipng bash coreutils && \
    apk add clisp --repository http://dl-cdn.alpinelinux.org/alpine/edge/testing && \
    cd /tmp && \
    wget https://sourceforge.net/projects/maxima/files/Maxima-source/5.41.0-source/maxima-5.41.0.tar.gz && \
    tar xzf maxima-5.41.0.tar.gz && \
    cd maxima-5.41.0 && \
    ./configure && \
    make && \
    make install && \
    wget https://github.com/mneri/pnglatex/raw/master/pnglatex -O ~/pnglatex && \
    sed -i "s/tempfile -d \$TMPDIR -p f -s .tex/mktemp -p \$TMPDIR --suffix=.tex/g" ~/pnglatex && \
    apk del zip python3 make texinfo optipng clisp && \
    rm -rf /var/cache/apk/* /tmp/*

COPY build.sh /root/build.sh

WORKDIR /root

CMD [ "sh" ]
