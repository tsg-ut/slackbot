# ImageNet bot

## セットアップ手順

1. `imagenet/fixtures` ディレクトリを作成する
2. 以下のURLからファイルをダウンロードしてきて `imagenet/fixtures/deploy.prototxt` に置く
	* https://github.com/cvjena/cnn-models/blob/master/ResNet_preact/ResNet50_cvgj/deploy.prototxt
3. 以下の手順に従ってファイルをダウンロードしてきて `resnet50_cvgj_iter_320000.caffemodel` に置く
	* https://github.com/cvjena/cnn-models/blob/master/ResNet_preact/ResNet50_cvgj/model_download_link.txt
4. Dockerをインストールする
5. `docker pull bvlc/caffe:cpu`
