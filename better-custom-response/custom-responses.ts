interface CustomResponse {
    input: RegExp[],
    outputArray?: string[],
    outputFunction?: ((input: string)=> string),
    command?: string,
}

const customResponses: CustomResponse[] = [
    {
        input: [/^あほくさ$/],
        outputArray: [":ahokus-top-left::ahokusa-top-center::ahokusa-top-right:\n:ahokusa-bottom-left::ahokusa-bottom-center::ahokusa-bottom-right:"],
    },
    {
        input: [/^2d6$/, /^ダイス$/],
        outputArray: [":kurgm1::kurgm1:", ":kurgm1::kurgm2:", ":kurgm1::kurgm3:", ":kurgm1::kurgm4:", ":kurgm1::kurgm5:", ":kurgm1::kurgm6:", ":kurgm2::kurgm1:", ":kurgm2::kurgm2:", ":kurgm2::kurgm3:", ":kurgm2::kurgm4:", ":kurgm2::kurgm5:", ":kurgm2::kurgm6:", ":kurgm3::kurgm1:", ":kurgm3::kurgm2:", ":kurgm3::kurgm3:", ":kurgm3::kurgm4:", ":kurgm3::kurgm5:", ":kurgm3::kurgm6:", ":kurgm4::kurgm1:", ":kurgm4::kurgm2:", ":kurgm4::kurgm3:", ":kurgm4::kurgm4:", ":kurgm4::kurgm5:", ":kurgm4::kurgm6:", ":kurgm5::kurgm1:", ":kurgm5::kurgm2:", ":kurgm5::kurgm3:", ":kurgm5::kurgm4:", ":kurgm5::kurgm5:", ":kurgm5::kurgm6:", ":kurgm6::kurgm1:", ":kurgm6::kurgm2:", ":kurgm6::kurgm3:", ":kurgm6::kurgm4:", ":kurgm6::kurgm5:", ":kurgm6::kurgm6:"],
    },
    {
        input: [/^[0-9]+d[0-9]+$/],
        outputFunction: (input: string)=> {
            const dices = input.split('d').map((num) => Number(num));
            let retString = "";
            let result = 0;
            for (let diceIndex = 0; diceIndex < dices[0]; ++diceIndex){
                const face = Math.floor(Math.random() * dices[1] + 1);
                retString += face.toString() + " ";
                result += face;
            }
            retString += "= " + result.toString();
            return retString;
        },
    }
];

export default customResponses;
