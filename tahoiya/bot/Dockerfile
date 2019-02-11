FROM tensorflow/tensorflow:latest-py3
MAINTAINER Koki Takahashi <hakatasiloving@gmail.com>

COPY seq2seq.patch /root/seq2seq.patch

RUN cd $HOME && \
    apt-get update -y && \
    apt-get install git -y && \
    git clone https://github.com/google/seq2seq.git && \
    cd seq2seq && \
    git apply ../seq2seq.patch && \
    pip install -e . && \
    apt-get remove git -y && \
    apt-get autoremove -y && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY run.sh /root/run.sh

WORKDIR /root

CMD [ "sh" ]