import config from 'config';

import nodemailer from 'nodemailer';
import logger from './logger';


const smtp = config.get<{
    host: string;
    port: number;
    user: string;
    pass: string;
  }>('smtp');
 // console.log(smtp)
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465, // true for 465, false for other ports
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });
//test Transporter
transporter.verify((error,success)=>{
if(error){
    logger.error('Email transporter verification failed: ' + error);
}
});

//send actual email
export const sendEmail = async (mailOptions: nodemailer.SendMailOptions) => {
    try {
        const info = await transporter.sendMail(mailOptions);
    } catch (error) {
        logger.error('Error sending email: ' + error);
    }
};
