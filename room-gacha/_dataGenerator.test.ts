jest.mock('tinyreq');

import { fetchData } from './_dataGenerator';
// @ts-ignore
import tinyreq from 'tinyreq';
import { promises as fs } from 'fs';

describe('room-gacha _dataGenerator', () => {
    it('generates correct data', async () => {
        tinyreq.impl = jest.fn(async (url, callback) => {
            const data = await fs.readFile(`${__dirname}/city-select.test.html`, 'utf-8');
            if (callback) callback(null, data);
            return data;
        });
        const osakaData = await fetchData('osaka');
        expect(osakaData.cities).toMatchObject([
            { name: "大阪市都島区", key: "27102" },
            { name: "大阪市福島区", key: "27103" },
            { name: "大阪市此花区", key: "27104" },
            { name: "大阪市西区", key: "27106" },
            { name: "大阪市港区", key: "27107" },
            { name: "大阪市大正区", key: "27108" },
            { name: "大阪市天王寺区", key: "27109" },
            { name: "大阪市浪速区", key: "27111" },
            { name: "大阪市西淀川区", key: "27113" },
            { name: "大阪市東淀川区", key: "27114" },
            { name: "大阪市東成区", key: "27115" },
            { name: "大阪市生野区", key: "27116" },
            { name: "大阪市旭区", key: "27117" },
            { name: "大阪市城東区", key: "27118" },
            { name: "大阪市阿倍野区", key: "27119" },
            { name: "大阪市住吉区", key: "27120" },
            { name: "大阪市東住吉区", key: "27121" },
            { name: "大阪市西成区", key: "27122" },
            { name: "大阪市淀川区", key: "27123" },
            { name: "大阪市鶴見区", key: "27124" },
            { name: "大阪市住之江区", key: "27125" },
            { name: "大阪市平野区", key: "27126" },
            { name: "大阪市北区", key: "27127" },
            { name: "大阪市中央区", key: "27128" },
            { name: "堺市堺区", key: "27141" },
            { name: "堺市中区", key: "27142" },
            { name: "堺市東区", key: "27143" },
            { name: "堺市西区", key: "27144" },
            { name: "堺市南区", key: "27145" },
            { name: "堺市北区", key: "27146" },
            { name: "堺市美原区", key: "27147" },
            { name: "岸和田市", key: "27202" },
            { name: "豊中市", key: "27203" },
            { name: "池田市", key: "27204" },
            { name: "吹田市", key: "27205" },
            { name: "泉大津市", key: "27206" },
            { name: "高槻市", key: "27207" },
            { name: "貝塚市", key: "27208" },
            { name: "守口市", key: "27209" },
            { name: "枚方市", key: "27210" },
            { name: "茨木市", key: "27211" },
            { name: "八尾市", key: "27212" },
            { name: "泉佐野市", key: "27213" },
            { name: "富田林市", key: "27214" },
            { name: "寝屋川市", key: "27215" },
            { name: "河内長野市", key: "27216" },
            { name: "松原市", key: "27217" },
            { name: "大東市", key: "27218" },
            { name: "和泉市", key: "27219" },
            { name: "箕面市", key: "27220" },
            { name: "柏原市", key: "27221" },
            { name: "羽曳野市", key: "27222" },
            { name: "門真市", key: "27223" },
            { name: "摂津市", key: "27224" },
            { name: "高石市", key: "27225" },
            { name: "藤井寺市", key: "27226" },
            { name: "東大阪市", key: "27227" },
            { name: "泉南市", key: "27228" },
            { name: "四條畷市", key: "27229" },
            { name: "交野市", key: "27230" },
            { name: "大阪狭山市", key: "27231" },
            { name: "阪南市", key: "27232" },
            { name: "三島郡", key: "27300" },
            { name: "豊能郡", key: "27320" },
            { name: "泉北郡", key: "27340" },
            { name: "泉南郡", key: "27360" },
            { name: "南河内郡", key: "27380" },
        ]);
        expect(osakaData.ar).toBe('060');
        expect(osakaData.bs).toBe('040');
        expect(osakaData.ta).toBe('27');
    });
});