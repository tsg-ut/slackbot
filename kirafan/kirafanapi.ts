import axios from 'axios';
import internal from 'stream';

interface KirarafantasiaCard {
  name: string;
  nickname: string;
  ruby: string;
  illustUrl: string;
  titleId: number;
}

const dbHostUrl = 'https://database.kirafan.cn/';

const updateDatabase = async () => {
  const rawData = {assetBundle: {}, characterList: {}, nameList: {}, titleList: {}};
  await Promise.all([
    axios.get(dbHostUrl + 'assetBundle.json').then(res => {rawData.assetBundle = res.data;}), 
    axios.get(dbHostUrl + 'database/CharacterList.json').then(res => {rawData.characterList = res.data;}),
    axios.get(dbHostUrl + 'database/NamedList.json').then(res => {rawData.nameList = res.data;}),
    axios.get(dbHostUrl + 'database/TitleList.json').then(res => {rawData.titleList = res.data;})
  ])
  
  const cards = rawData.characterList;
}