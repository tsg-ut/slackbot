export VOCAB_SOURCE=${HOME}/model/entries.src.vocab.txt
export VOCAB_TARGET=${HOME}/model/entries.dst.tok.bpe.32000.vocab.txt
export SOURCES=/tmp/input.src.txt
export MODEL_DIR=${HOME}/model
export MODEL_CHECKPOINT=${HOME}/model/model.ckpt-427758

echo "$1" > $SOURCES

cd ${HOME}/seq2seq && PYTHONIOENCODING=utf-8 python -m bin.infer \
  --tasks "
    - class: DecodeText" \
  --model_params "
    vocab_source: $VOCAB_SOURCE
    vocab_target: $VOCAB_TARGET" \
  --model_dir $MODEL_DIR \
  --checkpoint_path $MODEL_CHECKPOINT \
  --input_pipeline "
    class: ParallelTextInputPipeline
    params:
      source_files:
        - $SOURCES"
