import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import scrapeIt from 'scrape-it';
import qs from 'qs';
import { Challenge, SolvedInfo } from './BasicTypes';

export interface profileTW{
  username: string,
  country: string,
  rank: string,
  score: string,
  comment: string,
  registeredAt: string,
  solvedChalls: SolvedInfo[],
}

const getAxiosClientTW = () => {
  const clientTW = axios.create({
    xsrfCookieName: 'csrftoken',
  });
  clientTW.defaults.withCredentials = false;
  return clientTW;
}

const axiosSetDebugInfo = (instance: AxiosInstance) => {
  instance.interceptors.request.use((request: AxiosRequestConfig) => {
    console.log(`REQUEST: ${request.method} ${request.url}`);
    console.log(request.data);
    console.log(request.headers);
    return request;
  })
  instance.interceptors.response.use((response: AxiosResponse) => {
    console.log('RESPONSE');
    console.log(response.status);
    console.log(response.headers);
    return response;
  })
}

const clientTW = getAxiosClientTW();
let csrfmiddlewaretokenTW = '';
let csrftoken = '';
let sessionidTW = '';

const parseProfileTW = async (html: any) => {
  // Parse profile except for solved challs.
  const { fetchedBasicProfile } = await scrapeIt.scrapeHTML<{ fetchedBasicProfile: profileTW[] }>(html, {
    fetchedBasicProfile: {
      listItem: 'div.col-md-8 > div.row > div.col-md-9',
      data: {
        username: {
          selector: 'div.row > div.col-md-10',
          eq: 0,
        },
        country: {
          selector: 'div.row > div.col-md-10',
          eq: 1,
        },
        rank: {
          selector: 'div.row > div.col-md-10',
          eq: 2,
        },
        score: {
          selector: 'div.row > div.col-md-10',
          eq: 3,
        },
        comment: {
          selector: 'div.row > div.col-md-10',
          eq: 4,
        },
        registeredAt: {
          selector: 'div.row > div.col-md-10',
          eq: 5,
        },
      },
    }
  });
  const fetchedProfile: profileTW = {
    ...fetchedBasicProfile[0],
  }

  // Parse solved challs.
  const { solvedChalls } = await scrapeIt.scrapeHTML<{ solvedChalls: SolvedInfo[] }>(html, {
    solvedChalls: {
      listItem: 'table > tbody > tr',
      data: {
        id: {
          selector: 'td > a',
          attr: 'href',
          convert: (url_challenge) => url_challenge.substring('/challenge/#'.length, url_challenge.lenth),
        },
        name: {
          selector: 'td > a',
        },
        solvedAt: {
          selector: 'td',
          eq: 3,
          convert: (str_date) => new Date(str_date),
        },
        score: {
          selector: 'td',
          eq: 2,
          convert: (str_score) => Number(str_score),
        }
      }
    }
  });
  fetchedProfile.solvedChalls = solvedChalls;

  return fetchedProfile;
}


const getCsrfsTW = (res: AxiosResponse) => {
  const html = res.data;
  const candMiddle = html.match((/ {3}<input type='hidden' name='csrfmiddlewaretoken' value='([A-Za-z0-9]+)' \/>/))[1];
  csrfmiddlewaretokenTW = candMiddle ? candMiddle : csrfmiddlewaretokenTW;

  const candCsrf = String(res.headers["set-cookie"]).split(" ")[0];
  csrftoken = candCsrf ? candCsrf : csrftoken;
}

const loginTW = async () => {
  //csrfmiddlewaretokenTW = null;
  //sessionidTW = null;

  const res1 = await clientTW.get('https://pwnable.tw/user/login');
  getCsrfsTW(res1);
  const res2 = await clientTW.request({
    url: 'https://pwnable.tw/user/login',
    method: "post",
    headers: {
      Cookie: csrftoken,
      Referer: 'https://pwnable.tw/',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    maxRedirects: 0,
    data:
      qs.stringify({
        csrfmiddlewaretoken: csrfmiddlewaretokenTW,
        username: process.env.TWUSER,
        password: process.env.TWPW,
      }),
  }).catch(data => data.response.headers).then(headers => {
    sessionidTW = String(headers['set-cookie'][1]).split(" ")[0];
  });
}



export async function fetchUserProfile(userId: string){
  await loginTW();
  try {
    const { data: html } = await clientTW.get(`https://pwnable.tw/user/${userId}`, {
      headers: {
        Cookie: sessionidTW,
      },
    });
    return await parseProfileTW(html);
  } catch {
    return null;
  }
}

// update challs and solved-state of pwnable.tw
export async function fetchChallsTW() {
  // fetch data
  const { data: html } = await clientTW.get('https://pwnable.tw/challenge/', {
    headers: {}
  });
  const { fetchedChalls } = await scrapeIt.scrapeHTML<{ fetchedChalls: Challenge[] }>(html, {
    fetchedChalls: {
      listItem: 'li.challenge-entry',
      data: {
        name: {
          selector: 'div.challenge-info > .title > p > .tititle',
        },
        score: {
          selector: 'div.challenge-info > .title > p > .score',
          convert: (str_score) => Number(str_score.substring(0, str_score.length - ' pts'.length)),
        },
        id: {
          attr: 'id',
          convert: (id_str) => Number(id_str.substring('challenge-id-'.length)),
        }
      },
    }
  });

  return fetchedChalls;
}
