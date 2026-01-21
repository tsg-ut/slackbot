import { KirafanCard, kirafanTools, getKirafanCards } from './';
import { AteQuizProblem, AteQuiz } from '../atequiz';
import { SlackInterface } from '../lib/slack';
import sharp, { OverlayOptions } from 'sharp';
import axios from 'axios';
import { random, sample } from 'lodash';
import { ChatPostMessageArguments, GenericMessageEvent } from '@slack/web-api';
import cloudinary, { UploadApiResponse } from 'cloudinary';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import { hiraganize } from 'japanese';
import { increment } from '../achievements';
import { ChannelLimitedBot } from '../lib/channelLimitedBot';
import { Deferred } from '../lib/utils';

interface KirafanAteQuizProblem extends AteQuizProblem {
  correctAnswerCard: KirafanCard;
}

class KirafanAteQuiz extends AteQuiz {
  judge(answer: string): boolean {
    const normalize = (s: string) =>
      hiraganize(s.replace(/\P{Letter}/gu, '').toLowerCase());
    const normalizedAnswer = normalize(answer);
    return this.problem.correctAnswers.some(
      correctAnswer => normalizedAnswer === normalize(correctAnswer)
    );
  }
}

type ImageFilter = (image: sharp.Sharp) => Promise<Buffer>;

/**
 * Generate pictures for hints and store them in the local storage.
 * @param url url of the original image
 * @returns an array of string that contains filepaths of images
 */
const generateHintPictures = async (url: string) => {
  const originalSharp = sharp(
    await axios.get(url, { responseType: 'arraybuffer' }).then(res => res.data)
  );

  const trimmedSharp = await (async () => {
    const {
      data: halfTrimmedBuffer,
      info: { trimOffsetTop: trimmedFromTop },
    } = await originalSharp
      .clone()
      .trim()
      .rotate(180)
      .toBuffer({ resolveWithObject: true });

    const trimmedOriginal = sharp(halfTrimmedBuffer).trim().rotate(180);

    const trimmedFromBottom = (
      await trimmedOriginal.toBuffer({ resolveWithObject: true })
    ).info.trimOffsetTop;

    const { width, height } = await originalSharp.metadata();

    const trimmedTopBottomBuffer = await originalSharp
      .clone()
      .extract({
        top: -trimmedFromTop,
        left: 0,
        width,
        height: height - -trimmedFromTop - -trimmedFromBottom,
      })
      .toBuffer();

    return sharp(
      await sharp({
        create: {
          width,
          height: height - -trimmedFromTop - -trimmedFromBottom,
          channels: 4,
          background: '#FFFFFFFF',
        },
      })
        .composite([{ input: trimmedTopBottomBuffer, top: 0, left: 0 }])
        .png()
        .toBuffer()
    );
  })();

  const uniformedRandom = (max: number) => random(0, max - 1);
  const biasedRandom = (max: number) => {
    const r = Math.random() * 2 - 1;
    return Math.max(
      0,
      Math.min(max - 1, Math.floor(((r * r * r + r + 2) / 4) * max))
    );
  };

  const getFrac = async (
    image: sharp.Sharp,
    metadata: { width: number; height: number }
  ) => {
    const { width, height } = metadata;
    const newSize = 20;
    return image
      .clone()
      .extract({
        left: biasedRandom(width - newSize),
        top: uniformedRandom(height - newSize),
        width: newSize,
        height: newSize,
      })
      .toBuffer();
  };

  const filtersArray: ImageFilter[][] = [
    [
      async (image: sharp.Sharp) => {
        const { width, height } = await image.metadata();
        const newHeight = Math.floor(width / 100);
        return image
          .clone()
          .extract({
            left: 0,
            top: uniformedRandom(height - newHeight),
            width: width,
            height: newHeight,
          })
          .toBuffer();
      },
    ],
    [
      async (image: sharp.Sharp) => {
        const { width, height } = await image.metadata();
        const newSize = 20;
        const cols = 10;
        const rows = 3;
        const gap = 5;

        const fracs = await Promise.all(
          new Array<number>(cols * rows).fill(0).map(async (_, index) => {
            return {
              input: await getFrac(image, { width, height }),
              top: Math.floor(index / cols) * (newSize + gap),
              left: (index % cols) * (newSize + gap),
            } as OverlayOptions;
          })
        );

        return sharp({
          create: {
            width: newSize * cols + gap * (cols - 1),
            height: newSize * rows + gap * (rows - 1),
            channels: 4,
            background: '#FFFFFF00',
          },
        })
          .composite(fracs)
          .png()
          .toBuffer();
      },
    ],
    [
      async (image: sharp.Sharp) => {
        const { width, height } = await image.metadata();
        const newSize = 150;
        const pixelSize = newSize / 10;
        return sharp(
          await image
            .clone()
            .extract({
              left: biasedRandom(width - newSize),
              top: uniformedRandom(height - newSize),
              width: newSize,
              height: newSize,
            })
            .resize(pixelSize, pixelSize)
            .toBuffer()
        )
          .resize(newSize, newSize, { kernel: sharp.kernel.nearest })
          .toBuffer();
      },
    ],
    [
      async (image: sharp.Sharp) => {
        const { width, height } = await image.metadata();
        const newSize = 150;
        return image
          .clone()
          .extract({
            left: biasedRandom(width - newSize),
            top: uniformedRandom(height - newSize),
            width: newSize,
            height: newSize,
          })
          .toBuffer();
      },
    ],
    [
      async (image: sharp.Sharp) => {
        const { width, height } = await image.metadata();
        const newHeight = Math.floor(width / 2);
        return image
          .clone()
          .extract({
            left: 0,
            top: uniformedRandom(height - newHeight),
            width,
            height: newHeight,
          })
          .toBuffer();
      },
    ],
  ];

  const urlsArray = await Promise.all(
    filtersArray.map(
      async filters =>
        await Promise.all(
          filters.map(async filter => {
            const imageBuffer = await filter(trimmedSharp);
            return (
              (await new Promise((resolve, reject) =>
                cloudinary.v2.uploader
                  .upload_stream(
                    { resource_type: 'image' },
                    (error, response) => {
                      if (error) {
                        reject(error);
                      } else {
                        resolve(response);
                      }
                    }
                  )
                  .end(imageBuffer)
              )) as UploadApiResponse
            ).secure_url as string;
          })
        )
    )
  );

  /* 直列処理
  const sequentialUploadTimeout = 300;
  const urlsArray: string[][] = new Array(filtersArray.length)
    .fill(0)
    .map(() => []);
  for (let i = 0; i < filtersArray.length; i++) {
    for (const filter of filtersArray[i]) {
      const imageBuffer = await filter(trimmedSharp);
      urlsArray[i].push(
        ((await new Promise((resolve, reject) =>
          cloudinary.v2.uploader
            .upload_stream({ resource_type: 'image' }, (error, response) => {
              if (error) {
                reject(error);
              } else {
                resolve(response);
              }
            })
            .end(imageBuffer)
        )) as UploadApiResponse).secure_url as string
      );
      await new Promise<void>(resolve => {
        setTimeout(() => {
          resolve();
        }, sequentialUploadTimeout);
      });
    }
  }
  */

  return urlsArray;
};

const generateCorrectAnswers = (card: KirafanCard) => {
  return [card.fullname, ...card.fullname.split(/\s+/), card.nickname];
};

const generateProblem = async (
  card: KirafanCard,
  channel: string
): Promise<KirafanAteQuizProblem> => {
  const hintImageUrls = await generateHintPictures(
    kirafanTools.getKirafanCardBustIllustUrl(card.cardId)
  );

  const problemMessage: ChatPostMessageArguments = {
    channel,
    text: 'こちらの方、どなたでしょう？',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'plain_text',
          text: 'こちらの方、どなたでしょう？',
          emoji: true,
        },
      },
      {
        type: 'image',
        block_id: 'image',
        image_url: hintImageUrls[0][0],
        alt_text: 'こちらの方、どなたでしょう？',
      },
    ],
  };

  const hintTexts = [
    'ヒント、開きますよーっ！',
    '次のヒントです！この方は…',
    'まだまだいきますよー！',
    '最後のヒントです！わかりましたか？',
  ];
  const hintMessages: ChatPostMessageArguments[] = hintTexts.map(
    (text, index) => ({
      channel,
      text,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'plain_text',
            text,
            emoji: true,
          },
        },
        ...[
          {
            type: 'image',
            block_id: 'image',
            image_url: hintImageUrls[index + 1][0],
            alt_text: text,
          },
        ],
      ],
    })
  );

  const immediateMessage = {
    channel,
    text: '15秒でヒントです！',
  };

  const solvedMessage = {
    channel,
    text: `<@[[!user]]>さん、正解です！:tada:\nこの方は『${card.title}』の＊${card.fullname}＊さんです！す、す、すごかったです！:cherry_blossom:`,
    reply_broadcast: true,
  };

  const unsolvedMessage = {
    channel,
    text: `正解は『${card.title}』の＊${card.fullname}＊さんでした！またいつでも来てくださいね！:key:`,
    reply_broadcast: true,
  };

  const answerMessage = {
    channel,
    text: card.fullname,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `＊${card.fullname}＊ (${card.title})\n` +
            '★'.repeat(card.rare + 1) +
            ` ${kirafanTools.kirafanElementNames[card.element]} ${
              kirafanTools.kirafanClassNames[card.class]
            }`,
        },
      },
      {
        type: 'image',
        block_id: 'image',
        image_url: kirafanTools.getKirafanCardPictureUrl(card.cardId),
        alt_text:
          `＊${card.fullname}＊ (${card.title})\n` +
          '★'.repeat(card.rare + 1) +
          ` ${kirafanTools.kirafanElementNames[card.element]} ${
            kirafanTools.kirafanClassNames[card.class]
          }`,
      },
    ],
  };

  const correctAnswers = generateCorrectAnswers(card);

  const problem = {
    problemMessage,
    hintMessages,
    immediateMessage,
    solvedMessage,
    unsolvedMessage,
    answerMessage,
    correctAnswers,
    correctAnswerCard: JSON.parse(JSON.stringify(card)),
  } as KirafanAteQuizProblem;

  return problem;
};

class KirafanQuizBot extends ChannelLimitedBot {
  protected override readonly wakeWordRegex = /^きらファン当てクイズ(\s?(easy|[☆★]3))?$/;

  protected override readonly username = 'クレア';

  protected override readonly iconEmoji = ':claire_kirarafantasia:';

  protected override onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
    const quizMessageDeferred = new Deferred<string | null>();

    (async () => {
      const isEasyMode = message.text.match(/^きらファン当てクイズ\s?(easy|[☆★]3)$/);
      
      const randomKirafanCard = isEasyMode
        ? sample((await getKirafanCards()).filter(card => card.rare === 2))
        : sample(await getKirafanCards());

      const problem = await generateProblem(randomKirafanCard, channel);
      const quiz = new KirafanAteQuiz(this.slackClients, problem, {
        icon_emoji: this.iconEmoji,
        username: isEasyMode ? 'クレア（やさしい）' : this.username,
      });

      const result = await quiz.start({
        mode: 'normal',
        onStarted(startMessage) {
          quizMessageDeferred.resolve(startMessage.ts!);
        },
      });

      await this.deleteProgressMessage(await quizMessageDeferred.promise);

      if (result.state === 'solved') {
        if (isEasyMode) {
          await increment(result.correctAnswerer, 'kirafan-easy-answer');
          if (result.hintIndex === 0) {
            await increment(
              result.correctAnswerer,
              'kirafan-easy-answer-first-hint'
            );
          }
          if (result.hintIndex <= 1) {
            await increment(
              result.correctAnswerer,
              'kirafan-easy-answer-second-hint'
            );
          }
          if (result.hintIndex <= 2) {
            await increment(
              result.correctAnswerer,
              'kirafan-easy-answer-third-hint'
            );
          }
        } else {
          await increment(result.correctAnswerer, 'kirafan-answer');
          if (result.hintIndex === 0) {
            await increment(result.correctAnswerer, 'kirafan-answer-first-hint');
          }
          if (result.hintIndex <= 1) {
            await increment(result.correctAnswerer, 'kirafan-answer-second-hint');
          }
          if (result.hintIndex <= 2) {
            await increment(result.correctAnswerer, 'kirafan-answer-third-hint');
          }
        }
      }
    })().catch((error: unknown) => {
      this.log.error('Failed to start kirafan quiz', error);
      const errorText =
        error instanceof Error && error.stack !== undefined
          ? error.stack : String(error);
      this.postMessage({
        channel,
        text: `エラー😢\n\`${errorText}\``,
      });
      quizMessageDeferred.resolve(null);
    });

    return quizMessageDeferred.promise;
  }
}

// eslint-disable-next-line require-jsdoc
export default function kirafanQuiz(slackClients: SlackInterface) {
  return new KirafanQuizBot(slackClients);
}
