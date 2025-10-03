const axios = require('axios');
const { ethers } = require('ethers');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { generateProxyConfig, generateDynamicProxyConfig, getFixedProxyConfig } = require('./proxy');
const randomUseragent = require('random-useragent');
const captchaQueue = require('./captcha-queue');

class GataAuth {
    constructor(privateKey, proxyIndex = null) {
        // 确保私钥有0x前缀
        this.privateKey = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
        this.wallet = new ethers.Wallet(this.privateKey);
        this.address = this.wallet.address;
        this.token = null;
        this.taskToken = null;
        this.inviteCode = null; // 保存邀请码
        this.proxyIndex = proxyIndex; // 代理索引，用于分配固定代理
        
        // 根据是否有代理索引来决定使用固定代理还是动态代理
        if (proxyIndex !== null) {
            this.proxyConfig = getFixedProxyConfig(proxyIndex);
            console.log(`[${this.address}] 使用固定代理 (索引: ${proxyIndex}): ${this.proxyConfig.host}:${this.proxyConfig.port}`);
        } else {
            this.proxyConfig = generateProxyConfig();
            console.log(`[${this.address}] 使用动态代理: ${this.proxyConfig.host}:${this.proxyConfig.port}`);
        }
        
        this.captchaCompleted = false; // 人机验证完成标志
        
        // 为每个实例生成固定的随机User-Agent
        this.userAgent = randomUseragent.getRandom(ua => ua.browserName === 'Chrome' && ua.osName === 'Windows');
        console.log(`[${this.address}] 使用User-Agent: ${this.userAgent}`);
        
        // 创建带代理的axios实例
        this.axiosInstance = axios.create({
            httpsAgent: new HttpsProxyAgent(this.proxyConfig.proxyUrl),
            timeout: 180000
        });
    }

    // 获取签名信息
    async getSignatureNonce() {
        try {
            console.log(`[${this.address}] 获取签名信息...`);
            
            const response = await this.axiosInstance.post('https://earn.gata.net/api/signature_nonce', {
                address: this.address
            }, {
                headers: {
                    "accept": "application/json, text/plain, */*",
                    "accept-language": "zh-CN,zh;q=0.9",
                    "content-type": "application/json",
                    "user-agent": this.userAgent,
                    "priority": "u=1, i",
                    "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"Windows\"",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "cross-site"
                }
            });

            if (response.data.code === 0) {
                console.log(`[${this.address}] 获取签名信息成功`);
                return response.data.auth_nonce;
            } else {
                throw new Error(`获取签名信息失败: ${response.data.msg}`);
            }
        } catch (error) {
            console.error(`[${this.address}] 获取签名信息失败: ${error.message}`);
            throw error;
        }
    }

    // 签名消息
    async signMessage(message) {
        try {
            const signature = await this.wallet.signMessage(message);
            console.log(`[${this.address}] 消息签名成功`);
            return signature;
        } catch (error) {
            console.error(`[${this.address}] 消息签名失败: ${error.message}`);
            throw error;
        }
    }

    // 授权登录
    async authorize(signature, inviteCode = null) {
        try {
            console.log(`[${this.address}] 进行授权登录...`);
            
            const requestBody = {
                public_address: this.address,
                signature_code: signature
            };
            
            // 只有在提供邀请码时才添加到请求体中
            if (inviteCode) {
                requestBody.invite_code = inviteCode;
            }
            
            const response = await this.axiosInstance.post('https://earn.gata.net/api/authorize', requestBody, {
                headers: {
                    "accept": "application/json, text/plain, */*",
                    "accept-language": "zh-CN,zh;q=0.9",
                    "content-type": "application/json",
                    "user-agent": this.userAgent,
                    "priority": "u=1, i",
                    "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"Windows\"",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "cross-site"
                }
            });

            if (response.data.code === 0) {
                this.token = response.data.token;
                this.inviteCode = response.data.invite_code; // 保存邀请码
                console.log(`[${this.address}] 授权登录成功`);
                console.log(`[${this.address}] 邀请码: ${this.inviteCode || '无'}`);
                return response.data;
            } else {
                throw new Error(`授权登录失败: ${response.data.msg}`);
            }
        } catch (error) {
            console.error(`[${this.address}] 授权登录失败: ${error.message}`);
            throw error;
        }
    }

    // 获取账户信息
    async getProfile() {
        try {
            if (!this.token) {
                throw new Error('未登录，请先进行授权');
            }

            console.log(`[${this.address}] 获取账户信息...`);
            
            const response = await this.axiosInstance.get('https://earn.gata.net/api/profile', {
                headers: {
                    "accept": "application/json, text/plain, */*",
                    "accept-language": "zh-CN,zh;q=0.9",
                    "authorization": `Bearer ${this.token}`,
                    "user-agent": this.userAgent,
                    "priority": "u=1, i",
                    "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"Windows\"",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "cross-site"
                }
            });

            if (response.data.code === 0) {
                console.log(`[${this.address}] 获取账户信息成功`);
                const profile = response.data.profile;
                
                // 保存重要信息
                console.log(`[${this.address}] 当前等级: ${profile.user_level || 1}`);
                console.log(`[${this.address}] 邀请人数: ${profile.invited_count || 0}`);
                
                return profile;
            } else {
                throw new Error(`获取账户信息失败: ${response.data.msg}`);
            }
        } catch (error) {
            console.error(`[${this.address}] 获取账户信息失败: ${error.message}`);
            throw error;
        }
    }

    // 完整的登录流程
    async login(inviteCode = null) {
        try {
            console.log(`[${this.address}] 开始登录流程...`);
            
            // 1. 获取签名信息
            const authNonce = await this.getSignatureNonce();
            
            // 2. 签名消息
            const signature = await this.signMessage(authNonce);
            
            // 3. 授权登录
            const authResult = await this.authorize(signature, inviteCode);
            
            // 4. 获取账户信息
            const profile = await this.getProfile();
            
            console.log(`[${this.address}] 登录流程完成`);
            return {
                authResult,
                profile
            };
        } catch (error) {
            console.error(`[${this.address}] 登录流程失败: ${error.message}`);
            throw error;
        }
    }

    // ==================== 人机验证相关功能 ====================

    // 获取人机验证token
    async getCaptchaToken() {
        try {
            console.log(`[${this.address}] 正在获取人机验证token...`);
            const token = await captchaQueue.getCaptchaToken(this.address);
            console.log(`[${this.address}] 人机验证token获取成功`);
            return token;
        } catch (error) {
            console.error(`[${this.address}] 获取人机验证token失败: ${error.message}`);
            throw error;
        }
    }

    // 提交人机验证结果
    async submitCaptchaGrant(siteToken) {
        try {
            console.log(`[${this.address}] 正在提交人机验证结果... ${siteToken.substring(0, 20)}...`);
            
            // 确保有token
            if (!this.token) {
                throw new Error('未登录，无法提交人机验证结果');
            }
            
            const response = await this.axiosInstance.post('https://earn.gata.net/api/grant', {
                type: 2,
                site_token: siteToken
            }, {
                headers: {
                    "accept": "application/json, text/plain, */*",
                    "accept-language": "zh-CN,zh;q=0.9",
                    "content-type": "application/json",
                    "authorization": `Bearer ${this.token}`,
                    "user-agent": this.userAgent,
                    "priority": "u=1, i",
                    "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"Windows\"",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "cross-site"
                }
            });

            if (response.data.code === 0) {
                console.log(`[${this.address}] 人机验证结果提交成功`);
                this.taskToken = response.data.token
                return response.data;
            } else {
                throw new Error(`人机验证结果提交失败: ${response.data.msg}`);
            }
        } catch (error) {
            console.error(`[${this.address}] 人机验证结果提交失败: ${error.message}`);
            throw error;
        }
    }

    // 执行人机验证流程
    async executeCaptchaFlow() {
        try {
            console.log(`[${this.address}] 开始执行人机验证流程...`);
            
            // 1. 获取人机验证token
            const siteToken = await this.getCaptchaToken();
            
            // 2. 提交人机验证结果
            const result = await this.submitCaptchaGrant(siteToken);
            
            console.log(`[${this.address}] 人机验证流程完成`);
            return result;
        } catch (error) {
            console.error(`[${this.address}] 人机验证流程失败: ${error.message}`);
            throw error;
        }
    }

    // ==================== 任务相关功能 ====================

    // 获取Gata任务
    async getTask() {
        try {
            // 如果没有token，先自动登录
            if (!this.token) {
                console.log(`[${this.address}] 未登录，正在自动登录...`);
                await this.login();
            }

            // 首次获取任务前执行人机验证
            if (!this.captchaCompleted) {
                console.log(`[${this.address}] 首次获取任务，执行人机验证...`);
                await this.executeCaptchaFlow();
                this.captchaCompleted = true;
            }

            console.log(`[${this.address}] 正在获取Gata任务...`);
            
            const response = await this.axiosInstance.get('https://agent.gata.xyz/api/task', {
                headers: {
                    "accept": "application/json, text/plain, */*",
                    "accept-encoding": "gzip, deflate, br, zstd",
                    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,ru;q=0.7",
                    "authorization": `Bearer ${this.taskToken}`,
                    "connection": "keep-alive",
                    "host": "agent.gata.xyz",
                    "origin": "https://app.gata.xyz",
                    "referer": "https://app.gata.xyz/",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "same-site",
                    "user-agent": this.userAgent,
                    "x-gata-endpoint": "pc-browser",
                    "sec-ch-ua": "\"Not;A=Brand\";v=\"99\", \"Google Chrome\";v=\"139\", \"Chromium\";v=\"139\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"Windows\""
                }
            });

            if (response.status === 200) {
                console.log(`[${this.address}] 获取任务成功`);
                return response.data;
            } else {
                throw new Error(`获取任务失败，状态码: ${response.status}`);
            }
        } catch (error) {
            if (error.response && error.response.status === 502) {
                console.warn(`[${this.address}] 服务器返回502错误，等待50-80秒后重试...`);
                const delay = Math.floor(Math.random() * (80000 - 50000 + 1)) + 50000; // 50-80秒随机延迟
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.getTask(); // 递归重试
            }
            
            // 401错误时执行人机验证
            if (error.response && error.response.status === 401) {
                console.warn(`[${this.address}] 获取任务失败: 401未授权，执行人机验证后重试...`);
                try {
                    await this.executeCaptchaFlow();
                    // 重新获取任务
                    return this.getTask();
                } catch (captchaError) {
                    console.error(`[${this.address}] 人机验证失败: ${captchaError.message}`);
                    throw captchaError;
                }
            }
            
            console.error(`[${this.address}] 获取任务失败: ${error.message}`);
            throw error;
        }
    }

    // 查询今日任务获得积分
    async getTaskRewards(page = 0, perPage = 10) {
        try {
            // 如果没有token，先自动登录
            if (!this.token) {
                console.log(`[${this.address}] 未登录，正在自动登录...`);
                await this.login();
            }
            let daytoken = null
            console.log(`[${this.address}] 正在查询任务积分...`);
            const res = await this.axiosInstance.post(`https://earn.gata.net/api/grant`,{ type : 1 },{
                headers: {
                    "accept": "application/json, text/plain, */*",
                    "accept-encoding": "gzip, deflate, br, zstd",
                    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,ru;q=0.7",
                    "authorization": `Bearer ${this.token}`,
                    "connection": "keep-alive",
                    "origin": "https://app.gata.xyz",
                    "referer": "https://app.gata.xyz/",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "same-site",
                    "user-agent": this.userAgent,
                    "x-gata-endpoint": "pc-browser",
                    "sec-ch-ua": "\"Not;A=Brand\";v=\"99\", \"Google Chrome\";v=\"139\", \"Chromium\";v=\"139\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"Windows\""
                }
            });
            if (res.status === 200) {
                console.log(`[${this.address}] 获取今日积分token成功`);
                daytoken = res.data.token
            } else {
                throw new Error(`获取今日积分token失败: ${res.status}`);
            }

            const response = await this.axiosInstance.get(`https://agent.gata.xyz/api/task_rewards?page=${page}&per_page=${perPage}`, {
                headers: {
                    "accept": "application/json, text/plain, */*",
                    "accept-encoding": "gzip, deflate, br, zstd",
                    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,ru;q=0.7",
                    "authorization": `Bearer ${daytoken}`,
                    "connection": "keep-alive",
                    "host": "agent.gata.xyz",
                    "origin": "https://app.gata.xyz",
                    "referer": "https://app.gata.xyz/",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "same-site",
                    "user-agent": this.userAgent,
                    "x-gata-endpoint": "pc-browser",
                    "sec-ch-ua": "\"Not;A=Brand\";v=\"99\", \"Google Chrome\";v=\"139\", \"Chromium\";v=\"139\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"Windows\""
                }
            });

            if (response.status === 200) {
                console.log(`[${this.address}] 查询积分成功`);
                return response.data;
            } else {
                throw new Error(`查询积分失败，状态码: ${response.status}`);
            }
        } catch (error) {
            if (error.response && error.response.status === 502) {
                console.warn(`[${this.address}] 服务器返回502错误，等待50-80秒后重试...`);
                const delay = Math.floor(Math.random() * (80000 - 50000 + 1)) + 50000; // 50-80秒随机延迟
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.getTaskRewards(page, perPage); // 递归重试
            }
            
            // 401错误时执行人机验证
            if (error.response && error.response.status === 401) {
                console.warn(`[${this.address}] 查询积分失败: 401未授权，执行人机验证后重试...`);
                try {
                    await this.executeCaptchaFlow();
                    // 重新查询积分
                    return this.getTaskRewards(page, perPage);
                } catch (captchaError) {
                    console.error(`[${this.address}] 人机验证失败: ${captchaError.message}`);
                    throw captchaError;
                }
            }
            
            console.error(`[${this.address}] 查询积分失败: ${error.message}`);
            throw error;
        }
    }

    // 执行任务循环
    async executeTaskLoop(intervalSeconds = 300) {
        let retryCount = 0;
        const maxRetries = 5;
        
        while (true) {
            try {
                // 如果没有token，先自动登录
                if (!this.token) {
                    console.log(`[${this.address}] 未登录，正在自动登录...`);
                    await this.login();
                }

                console.log(`[${this.address}] 开始执行任务循环，间隔: ${intervalSeconds}秒`);
                
                let taskCount = 0;
                let totalPoints = 0;
                let lastUpgradeCheck = 0; // 上次升级检查时间戳
                
                // 立即执行一次升级检查
                console.log(`[${this.address}] 立即执行等级升级检查...`);
                try {
                    const upgradeResult = await this.executeLevelUpgradeProcess();
                    if (upgradeResult.success) {
                        console.log(`[${this.address}] 等级升级成功！`);
                    } else {
                        console.log(`[${this.address}] 等级升级检查完成: ${upgradeResult.reason}`);
                    }
                } catch (error) {
                    console.error(`[${this.address}] 等级升级检查失败: ${error.message}`);
                }
                lastUpgradeCheck = Date.now();
                
                while (true) {
                    try {
                        taskCount++;
                        console.log(`\n[${this.address}] === 第 ${taskCount} 次任务执行 ===`);
                        console.log(`[${this.address}] 时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
                        
                        // 获取任务
                        const taskData = await this.getTask();
                        console.log(`[${this.address}] 任务数据:`, JSON.stringify(taskData, null, 2));
                        
                        // 查询积分
                        const rewardsData = await this.getTaskRewards();
                        console.log(`[${this.address}] 积分数据:`, JSON.stringify(rewardsData, null, 2));
                        
                        // 统计今日积分
                        if (rewardsData.rewards && rewardsData.rewards.length > 0) {
                            const today = new Date().toISOString().split('T')[0];
                            const todayReward = rewardsData.rewards.find(r => r.date === today);
                            if (todayReward) {
                                console.log(`[${this.address}] 今日积分: ${todayReward.total_points}`);
                                totalPoints = parseFloat(todayReward.total_points);
                            }
                        }
                        
                        // 每24小时检查一次等级升级
                        const now = Date.now();
                        const twentyFourHours = 24 * 60 * 60 * 1000; // 24小时的毫秒数
                        
                        if (now - lastUpgradeCheck >= twentyFourHours) {
                            console.log(`[${this.address}] 执行24小时等级升级检查...`);
                            try {
                                const upgradeResult = await this.executeLevelUpgradeProcess();
                                if (upgradeResult.success) {
                                    console.log(`[${this.address}] 等级升级成功！`);
                                } else {
                                    console.log(`[${this.address}] 等级升级检查完成: ${upgradeResult.reason}`);
                                }
                            } catch (error) {
                                console.error(`[${this.address}] 等级升级检查失败: ${error.message}`);
                            }
                            lastUpgradeCheck = now;
                        } else {
                            // 显示距离下次升级检查的时间
                            const remainingTime = twentyFourHours - (now - lastUpgradeCheck);
                            const remainingHours = Math.floor(remainingTime / (60 * 60 * 1000));
                            const remainingMinutes = Math.floor((remainingTime % (60 * 60 * 1000)) / (60 * 1000));
                            console.log(`[${this.address}] 距离下次等级升级检查还有: ${remainingHours}小时${remainingMinutes}分钟`);
                        }
                        
                        console.log(`[${this.address}] 任务执行完成，等待 ${intervalSeconds} 秒后继续...`);
                        
                    } catch (error) {
                        console.error(`[${this.address}] 第 ${taskCount} 次任务执行失败: ${error.message}`);
                        
                        // 即使任务执行失败，也检查一下升级条件（每24小时一次）
                        const now = Date.now();
                        const twentyFourHours = 24 * 60 * 60 * 1000;
                        
                        if (now - lastUpgradeCheck >= twentyFourHours) {
                            console.log(`[${this.address}] 任务执行失败，但执行24小时等级升级检查...`);
                            try {
                                const upgradeResult = await this.executeLevelUpgradeProcess();
                                if (upgradeResult.success) {
                                    console.log(`[${this.address}] 等级升级成功！`);
                                } else {
                                    console.log(`[${this.address}] 等级升级检查完成: ${upgradeResult.reason}`);
                                }
                            } catch (upgradeError) {
                                console.error(`[${this.address}] 等级升级检查失败: ${upgradeError.message}`);
                            }
                            lastUpgradeCheck = now;
                        }
                        
                        console.log(`[${this.address}] 等待 ${intervalSeconds} 秒后重试...`);
                    }
                    
                    // 等待指定时间
                    await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
                }
                
            } catch (error) {
                retryCount++;
                console.error(`[${this.address}] 任务循环第 ${retryCount} 次失败: ${error.message}`);
                
                if (retryCount >= maxRetries) {
                    console.error(`[${this.address}] 重试 ${maxRetries} 次后仍然失败，重启线程...`);
                    // 重置token，强制重新登录
                    this.token = null;
                    retryCount = 0;
                    // 等待30秒后重启
                    await new Promise(resolve => setTimeout(resolve, 30000));
                } else {
                    console.log(`[${this.address}] 等待30秒后进行第 ${retryCount + 1} 次重试...`);
                    await new Promise(resolve => setTimeout(resolve, 30000));
                }
            }
        }
    }

    // 获取任务统计信息
    async getTaskStats() {
        try {
            // 如果没有token，先自动登录
            if (!this.token) {
                console.log(`[${this.address}] 未登录，正在自动登录...`);
                await this.login();
            }

            const rewardsData = await this.getTaskRewards();
            
            if (rewardsData.rewards && rewardsData.rewards.length > 0) {
                const today = new Date().toISOString().split('T')[0];
                const todayReward = rewardsData.rewards.find(r => r.date === today);
                
                return {
                    totalPoints: rewardsData.total || 0,
                    completedCount: rewardsData.completed_count || 0,
                    todayPoints: todayReward ? parseFloat(todayReward.total_points) : 0,
                    recentRewards: rewardsData.rewards.slice(0, 5) // 最近5天的积分
                };
            }
            
            return {
                totalPoints: 0,
                completedCount: 0,
                todayPoints: 0,
                recentRewards: []
            };
        } catch (error) {
            console.error(`[${this.address}] 获取任务统计失败: ${error.message}`);
            throw error;
        }
    }

    // ==================== 等级升级相关功能 ====================

    // 获取等级条件
    async getLevels() {
        try {
            // 如果没有token，先自动登录
            if (!this.token) {
                console.log(`[${this.address}] 未登录，正在自动登录...`);
                await this.login();
            }

            console.log(`[${this.address}] 正在获取等级条件...`);
            
            const response = await this.axiosInstance.get('https://earn.gata.net/api/levels', {
                headers: {
                    "accept": "application/json, text/plain, */*",
                    "accept-encoding": "gzip, deflate, br, zstd",
                    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,ru;q=0.7",
                    "authorization": `Bearer ${this.token}`,
                    "connection": "keep-alive",
                    "host": "earn.gata.net",
                    "origin": "https://app.gata.xyz",
                    "referer": "https://app.gata.xyz/",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "cross-site",
                    "user-agent": this.userAgent,
                    "sec-ch-ua": "\"Not;A=Brand\";v=\"99\", \"Google Chrome\";v=\"139\", \"Chromium\";v=\"139\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"Windows\""
                }
            });

            if (response.status === 200 && response.data.code === 0) {
                console.log(`[${this.address}] 获取等级条件成功`);
                return response.data.data.levels;
            } else {
                throw new Error(`获取等级条件失败，状态码: ${response.status}`);
            }
        } catch (error) {
            console.error(`[${this.address}] 获取等级条件失败: ${error.message}`);
            throw error;
        }
    }

    // 获取总积分
    async getTotalPoints() {
        try {
            // 如果没有token，先自动登录
            if (!this.token) {
                console.log(`[${this.address}] 未登录，正在自动登录...`);
                await this.login();
            }

            console.log(`[${this.address}] 正在获取总积分...`);
            
            const response = await this.axiosInstance.get('https://earn.gata.net/api/rewards?page=0&per_page=50', {
                headers: {
                    "accept": "application/json, text/plain, */*",
                    "accept-encoding": "gzip, deflate, br, zstd",
                    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,ru;q=0.7",
                    "authorization": `Bearer ${this.token}`,
                    "connection": "keep-alive",
                    "host": "earn.gata.net",
                    "origin": "https://app.gata.xyz",
                    "referer": "https://app.gata.xyz/",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "cross-site",
                    "user-agent": this.userAgent,
                    "sec-ch-ua": "\"Not;A=Brand\";v=\"99\", \"Google Chrome\";v=\"139\", \"Chromium\";v=\"139\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"Windows\""
                }
            });

            if (response.status === 200 && response.data.code === 0) {
                // 从point_details中的"9"字段获取总积分
                const totalPoints = parseInt(response.data.point_details?.["9"] || response.data.points || 0);
                console.log(`[${this.address}] 获取总积分成功: ${totalPoints}`);
                return totalPoints;
            } else {
                throw new Error(`获取总积分失败，状态码: ${response.status}`);
            }
        } catch (error) {
            console.error(`[${this.address}] 获取总积分失败: ${error.message}`);
            throw error;
        }
    }

    // 生成随机私钥
    generateRandomPrivateKey() {
        const wallet = ethers.Wallet.createRandom();
        return wallet.privateKey;
    }

    // 使用邀请码注册新账户（使用动态代理）
    async registerWithInviteCode(inviteCode) {
        try {
            const randomPrivateKey = this.generateRandomPrivateKey();
            const randomWallet = new ethers.Wallet(randomPrivateKey);
            const randomAddress = randomWallet.address;
            
            console.log(`[${this.address}] 正在使用邀请码 ${inviteCode} 注册新账户: ${randomAddress} (使用动态代理)`);
            
            // 创建新的GataAuth实例用于注册，使用动态代理
            const GataAuth = require('./gata-auth');
            const newGataAuth = new GataAuth(randomPrivateKey, null); // null表示使用动态代理
            
            // 使用邀请码登录
            await newGataAuth.login(inviteCode);
            
            console.log(`[${this.address}] 新账户注册成功: ${randomAddress}`);
            return {
                privateKey: randomPrivateKey,
                address: randomAddress
            };
        } catch (error) {
            console.error(`[${this.address}] 新账户注册失败: ${error.message}`);
            throw error;
        }
    }

    // 获取等级升级签名
    async getLevelUpgradeSignature(targetLevel) {
        try {
            console.log(`[${this.address}] 正在获取等级 ${targetLevel} 升级签名...`);
            
            const response = await this.axiosInstance.get(`https://earn.gata.net/api/levelup/sign/${targetLevel}`, {
                headers: {
                    "accept": "application/json, text/plain, */*",
                    "accept-language": "zh-CN",
                    "authorization": `Bearer ${this.token}`,
                    "priority": "u=1, i",
                    "sec-ch-ua": "\"Chromium\";v=\"130\", \"Google Chrome\";v=\"130\", \"Not?A_Brand\";v=\"99\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"Windows\"",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "cross-site",
                    "Referer": "https://app.gata.xyz/",
                    "Referrer-Policy": "strict-origin-when-cross-origin"
                }
            });

            if (response.data.code === 0) {
                console.log(`[${this.address}] 获取等级升级签名成功`);
                return response.data.data;
            } else {
                throw new Error(`获取等级升级签名失败: ${response.data.msg}`);
            }
        } catch (error) {
            console.error(`[${this.address}] 获取等级升级签名失败: ${error.message}`);
            throw error;
        }
    }

    // 执行等级升级合约调用
    async executeLevelUpgrade(level, bonus, signature) {
        try {
            console.log(`[${this.address}] 正在执行等级升级合约调用...`);
            
            // 创建opBNB provider
            const provider = new ethers.JsonRpcProvider('https://opbnb-mainnet-rpc.bnbchain.org');
            const wallet = new ethers.Wallet(this.privateKey, provider);
            
            // 升级合约地址和ABI
            const upgradeAddress = '0x8ab14d04538a1a15cfe21faaf25d69e7433eb675';
            const upgradeABI = [{
                type: "function",
                name: "levelUpAndClaim",
                inputs: [{
                    name: "level",
                    type: "uint256",
                    internalType: "uint256"
                }, {
                    name: "bonus",
                    type: "uint256",
                    internalType: "uint256"
                }, {
                    name: "signature",
                    type: "bytes",
                    internalType: "bytes"
                }],
                outputs: [],
                stateMutability: "nonpayable"
            }];
            
            // 创建合约实例
            const contract = new ethers.Contract(upgradeAddress, upgradeABI, wallet);
            
            // 调用合约方法
            const txResponse = await contract.levelUpAndClaim(level, bonus, signature);
            console.log(`[${this.address}] 等级升级交易已发送: ${txResponse.hash}`);
            
            // 等待交易确认
            const receipt = await txResponse.wait();
            console.log(`[${this.address}] 等级升级交易已确认: ${receipt.hash}`);
            
            return receipt;
        } catch (error) {
            console.error(`[${this.address}] 等级升级合约调用失败: ${error.message}`);
            throw error;
        }
    }

    // 检查是否可以升级（支持连续升级）
    async checkLevelUpgrade() {
        try {
            console.log(`[${this.address}] 正在检查等级升级条件...`);
            
            // 获取账户信息
            const profile = await this.getProfile();
            const currentLevel = profile.user_level || 1;
            const invitedCount = profile.invited_count || 0;
            
            // 获取等级条件
            const levels = await this.getLevels();
            
            // 获取总积分
            const totalPoints = await this.getTotalPoints();
            console.log(`[${this.address}] 当前等级: ${currentLevel}, 邀请人数: ${invitedCount}, 总积分: ${totalPoints}`);
            
            // 检查可以连续升级到哪个等级
            const upgradableLevels = [];
            let maxUpgradableLevel = currentLevel;
            
            for (let targetLevel = currentLevel + 1; targetLevel <= levels.length; targetLevel++) {
                const levelData = levels.find(level => level.level === targetLevel);
                if (!levelData) break;
                
                // 检查升级条件
                const needsPoints = levelData.upgrade_points > totalPoints;
                const needsInvites = levelData.upgrade_invited_count > invitedCount;
                const upgradeCondition = levelData.upgrade_condition; // "AND" 或 "OR"
                
                let canUpgradeThisLevel = false;
                let reason = '';
                let shouldInvite = false;
                
                // 检查升级条件
                if (upgradeCondition === 'AND') {
                    canUpgradeThisLevel = !needsPoints && !needsInvites;
                    if (needsPoints && needsInvites) {
                        reason = `积分不足(${totalPoints}/${levelData.upgrade_points}) 且 邀请人数不足(${invitedCount}/${levelData.upgrade_invited_count})`;
                    } else if (needsPoints) {
                        reason = `积分不足，需要 ${levelData.upgrade_points}，当前 ${totalPoints}`;
                    } else if (needsInvites) {
                        reason = `邀请人数不足，需要 ${levelData.upgrade_invited_count}，当前 ${invitedCount}`;
                    }
                } else { // OR
                    canUpgradeThisLevel = !needsPoints || !needsInvites;
                    if (needsPoints && needsInvites) {
                        reason = `积分不足(${totalPoints}/${levelData.upgrade_points}) 且 邀请人数不足(${invitedCount}/${levelData.upgrade_invited_count})`;
                    } else if (needsPoints) {
                        reason = `积分不足，需要 ${levelData.upgrade_points}，当前 ${totalPoints}`;
                    } else if (needsInvites) {
                        reason = `邀请人数不足，需要 ${levelData.upgrade_invited_count}，当前 ${invitedCount}`;
                    }
                }
                
                // 如果积分达标但邀请人数不足，标记需要邀请
                if (!needsPoints && needsInvites) {
                    shouldInvite = true;
                    canUpgradeThisLevel = true;
                    reason = `积分已达标，需要邀请 ${levelData.upgrade_invited_count - invitedCount} 人`;
                }
                
                if (canUpgradeThisLevel) {
                    upgradableLevels.push({
                        level: targetLevel,
                        levelData: levelData,
                        reason: reason,
                        shouldInvite: shouldInvite,
                        neededInvites: shouldInvite ? levelData.upgrade_invited_count - invitedCount : 0
                    });
                    maxUpgradableLevel = targetLevel;
                } else {
                    // 如果这个等级不能升级，后面的等级也不能升级
                    break;
                }
            }
            
            if (upgradableLevels.length === 0) {
                console.log(`[${this.address}] 无法升级任何等级`);
                return { 
                    canUpgrade: false, 
                    reason: '无法升级任何等级',
                    currentLevel,
                    totalPoints,
                    invitedCount
                };
            }
            
            console.log(`[${this.address}] 可以连续升级到等级 ${maxUpgradableLevel}，共 ${upgradableLevels.length} 个等级`);
            
            return {
                canUpgrade: true,
                currentLevel,
                totalPoints,
                invitedCount,
                upgradableLevels: upgradableLevels,
                maxUpgradableLevel: maxUpgradableLevel,
                upgradeCount: upgradableLevels.length
            };
        } catch (error) {
            console.error(`[${this.address}] 检查等级升级失败: ${error.message}`);
            throw error;
        }
    }

    // 执行等级升级流程（支持连续升级）
    async executeLevelUpgradeProcess() {
        try {
            console.log(`[${this.address}] 开始执行等级升级流程...`);
            
            // 检查升级条件
            const upgradeCheck = await this.checkLevelUpgrade();
            
            if (!upgradeCheck.canUpgrade) {
                console.log(`[${this.address}] 不符合升级条件: ${upgradeCheck.reason}`);
                return { success: false, reason: upgradeCheck.reason };
            }
            
            console.log(`[${this.address}] 准备连续升级 ${upgradeCheck.upgradeCount} 个等级，从 ${upgradeCheck.currentLevel} 升级到 ${upgradeCheck.maxUpgradableLevel}`);
            
            const upgradeResults = [];
            let totalInvitedCount = 0;
            
            // 逐个处理每个可升级的等级
            for (const levelInfo of upgradeCheck.upgradableLevels) {
                console.log(`[${this.address}] 处理等级 ${levelInfo.level} 升级...`);
                
                // 如果需要邀请用户
                if (levelInfo.shouldInvite) {
                    console.log(`[${this.address}] 等级 ${levelInfo.level} 积分已达标，需要邀请用户...`);
                    
                    // 使用保存的邀请码
                    const inviteCode = this.inviteCode;
                    
                    if (inviteCode) {
                        const neededInvites = levelInfo.neededInvites;
                        console.log(`[${this.address}] 等级 ${levelInfo.level} 需要邀请 ${neededInvites} 个新账户`);
                        
                        for (let i = 0; i < neededInvites; i++) {
                            try {
                                await this.registerWithInviteCode(inviteCode);
                                console.log(`[${this.address}] 等级 ${levelInfo.level} 成功邀请第 ${i + 1} 个账户`);
                                // 等待一段时间再邀请下一个
                                await new Promise(resolve => setTimeout(resolve, 5000));
                            } catch (error) {
                                console.error(`[${this.address}] 等级 ${levelInfo.level} 邀请第 ${i + 1} 个账户失败: ${error.message}`);
                            }
                        }
                        
                        totalInvitedCount += neededInvites;
                        
                        // 邀请完成后，执行升级流程
                        console.log(`[${this.address}] 等级 ${levelInfo.level} 邀请完成，执行升级...`);
                        const upgradeResult = await this.executeLevelUpgradeWithSignature(levelInfo.level);
                        upgradeResults.push({
                            level: levelInfo.level,
                            upgradeResult: upgradeResult,
                            invitedCount: neededInvites
                        });
                        
                    } else {
                        console.error(`[${this.address}] 等级 ${levelInfo.level} 无法获取邀请码`);
                        return { success: false, reason: '无法获取邀请码' };
                    }
                } else {
                    // 直接符合升级条件，执行升级流程
                    console.log(`[${this.address}] 等级 ${levelInfo.level} 符合升级条件，执行升级...`);
                    const upgradeResult = await this.executeLevelUpgradeWithSignature(levelInfo.level);
                    upgradeResults.push({
                        level: levelInfo.level,
                        upgradeResult: upgradeResult,
                        invitedCount: 0
                    });
                }
                
                // 每个等级升级后等待一段时间
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
            
            console.log(`[${this.address}] 连续升级完成！共升级 ${upgradeResults.length} 个等级，邀请 ${totalInvitedCount} 个新账户`);
            return { 
                success: true, 
                upgradeResults: upgradeResults,
                totalUpgradedLevels: upgradeResults.length,
                totalInvitedCount: totalInvitedCount,
                fromLevel: upgradeCheck.currentLevel,
                toLevel: upgradeCheck.maxUpgradableLevel
            };
            
        } catch (error) {
            console.error(`[${this.address}] 等级升级流程失败: ${error.message}`);
            throw error;
        }
    }

    // 执行等级升级（获取签名 + 合约调用）
    async executeLevelUpgradeWithSignature(targetLevel) {
        try {
            console.log(`[${this.address}] 开始执行等级 ${targetLevel} 升级流程...`);
            
            // 1. 获取等级升级签名
            const signatureData = await this.getLevelUpgradeSignature(targetLevel);
            console.log(`[${this.address}] 获取到升级签名数据:`, signatureData);
            
            // 2. 调用合约执行升级
            const upgradeResult = await this.executeLevelUpgrade(
                signatureData.level,
                signatureData.level_up_bonus,
                signatureData.signature
            );
            
            console.log(`[${this.address}] 等级 ${targetLevel} 升级成功`);
            return {
                level: signatureData.level,
                bonus: signatureData.level_up_bonus,
                signature: signatureData.signature,
                transaction: upgradeResult
            };
        } catch (error) {
            console.error(`[${this.address}] 等级升级流程失败: ${error.message}`);
            throw error;
        }
    }
}

module.exports = GataAuth;