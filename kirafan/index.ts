import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

export interface KirafanCard {
  cardId: number;
  fullname: string;
  nickname: string;
  // ruby: string;
  title: string;
  rare: number;
  class: number;
  element: number;
}

interface KirafanCharacter {
  fullname: string;
  nickname: string;
  profile: string;
  cv: string;
  titleId: number;
}

interface KirafanTitle {
  titleId: number;
  title: string;
}

const dbHost = 'https://database.kirafan.cn/database/';
const assetHost = 'https://asset.kirafan.cn/';

export const kirafanTools = {
  kirafanClassNames: [
    'せんし',
    'まほうつかい',
    'そうりょ',
    'ナイト',
    'アルケミスト',
  ],
  kirafanElementNames: ['炎', '水', '土', '風', '月', '陽'],
  getKirafanCardIllustUrl(cardId: number): string {
    return (
      assetHost +
      `texture/charauiresource/charaillustchara/charaillust_chara_${cardId}.png`
    );
  },
  getKirafanCardPictureUrl(cardId: number): string {
    return (
      assetHost + `texture/charauiresource/characard/characard_${cardId}.png`
    );
  },
  getKirafanCardBustIllustUrl(cardId: number): string {
    return (
      assetHost +
      `texture/charauiresource/charaillustbust/charaillust_bust_${cardId}.png`
    );
  },
};

export const getKirafanCards = async (
  forceUpdate = false
): Promise<KirafanCard[]> => {
  const { timestamp } = (await promisify(fs.exists)(
    path.join(__dirname, 'timestamp.json')
  ))
    ? Object.assign(
        { timestamp: undefined },
        JSON.parse(
          await promisify(fs.readFile)(path.join(__dirname, 'timestamp.json'), {
            encoding: 'utf8',
          })
        )
      )
    : { timestamp: undefined };

  if (
    !forceUpdate &&
    timestamp &&
    Date.now() - timestamp < 1000 * 60 * 60 * 24
  ) {
    const cards = JSON.parse(
      await promisify(fs.readFile)(path.join(__dirname, 'kirafan-cards.json'), {
        encoding: 'utf8',
      })
    );
    return cards;
  }

  interface rawCharacter {
    m_CharaID: number;
    m_Name: string;
    m_NamedType: number;
    m_Rare: number;
    m_Class: number;
    m_Element: number;
    year: number;
  }

  interface rawName {
    m_NamedType: number;
    m_TitleType: number;
    m_NickName: string;
    m_FullName: string;
    m_ProfileText: string;
    m_CVText: string;
    fullName: string;
  }

  interface rawTitle {
    m_TitleType: number;
    m_DisplayName: string;
  }

  const rawData = {
    characterList: new Array<rawCharacter>(),
    nameList: new Array<rawName>(),
    titleList: new Array<rawTitle>(),
  };

  await Promise.all([
    axios.get(dbHost + 'CharacterList.json').then(res => {
      rawData.characterList = res.data;
    }),
    axios.get(dbHost + 'NamedList.json').then(res => {
      rawData.nameList = res.data;
    }),
    axios.get(dbHost + 'TitleList.json').then(res => {
      rawData.titleList = res.data;
    }),
  ]);

  const titleArray = (() => {
    const ret = new Array<KirafanTitle>(
      Math.max(...rawData.titleList.map(elem => elem.m_TitleType)) + 1
    );
    rawData.titleList.forEach(title => {
      ret[title.m_TitleType] = {
        titleId: title.m_TitleType,
        title: title.m_DisplayName,
      };
    });
    return ret;
  })();

  const nameArray = (() => {
    const ret = new Array<KirafanCharacter>(
      Math.max(...rawData.nameList.map(elem => elem.m_NamedType)) + 1
    );
    rawData.nameList.forEach(name => {
      ret[name.m_NamedType] = {
        fullname: name.fullName,
        nickname: name.m_NickName,
        profile: name.m_ProfileText,
        cv: name.m_CVText,
        titleId: name.m_TitleType,
      };
    });
    return ret;
  })();

  const cards = rawData.characterList.map(character => {
    const card: KirafanCard = {
      cardId: character.m_CharaID,
      fullname: nameArray[character.m_NamedType].fullname,
      nickname: nameArray[character.m_NamedType].nickname,
      title: titleArray[nameArray[character.m_NamedType].titleId].title,
      rare: character.m_Rare,
      class: character.m_Class,
      element: character.m_Element,
    };
    return card;
  });

  await promisify(fs.writeFile)(
    path.join(__dirname, 'kirafan-cards.json'),
    JSON.stringify(cards)
  );

  await promisify(fs.writeFile)(
    path.join(__dirname, 'timestamp.json'),
    JSON.stringify({ timestamp: Date.now() })
  );

  return cards;
};
