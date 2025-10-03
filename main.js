const GataAuth = require('./gata-auth');
const TransferManager = require('./transfer');
const Scheduler = require('./scheduler');
const Utils = require('./utils');

class GataBot {
    constructor() {
        this.privateKeys = [];
        this.scheduler = new Scheduler();
        this.isRunning = false;
    }

    // 初始化
    async initialize() {
        try {
            console.log('='.repeat(50));
            console.log('Gata自动化机器人启动中...');
            console.log('='.repeat(50));
            
            // 读取私钥
            this.privateKeys = await Utils.readPrivateKeys('keys.txt');
            
            if (this.privateKeys.length === 0) {
                throw new Error('未找到有效的私钥，请检查keys.txt文件');
            }

            // 验证私钥格式
            const invalidKeys = this.privateKeys.filter(key => !Utils.isValidPrivateKey(key));
            if (invalidKeys.length > 0) {
                console.warn(`发现 ${invalidKeys.length} 个无效私钥，将被跳过`);
                this.privateKeys = this.privateKeys.filter(key => Utils.isValidPrivateKey(key));
            }

            console.log(`成功加载 ${this.privateKeys.length} 个有效私钥`);
            this.isRunning = true;
            
        } catch (error) {
            console.error('初始化失败:', error.message);
            throw error;
        }
    }

    // 执行Gata注册登录 (异步多线程)
    async executeGataRegistration() {
        console.log('\n开始执行Gata注册登录...');
        
        // 准备任务数据
        const tasks = this.privateKeys.map((privateKey, index) => ({
            type: 'gata_auth',
            data: { privateKey, inviteCode: '8pply1m8', index }
        }));

        try {
            // 使用工作线程管理器批量执行任务
            const results = await this.scheduler.workerManager.executeBatch(tasks);
            
            // 统计结果
            const successCount = results.filter(r => r.success).length;
            const failureCount = results.filter(r => !r.success).length;
            
            console.log('\nGata注册登录完成');
            console.log(`成功: ${successCount}, 失败: ${failureCount}`);
            
            // 输出详细结果
            results.forEach((result, index) => {
                if (result.success) {
                    console.log(`钱包 ${index + 1} (${result.data.address}) 注册登录成功`);
                } else {
                    console.error(`钱包 ${index + 1} 注册登录失败: ${result.error}`);
                }
            });

            return results;
        } catch (error) {
            console.error('批量注册登录执行失败:', error.message);
            throw error;
        }
    }

    // 手动执行转账
    async executeManualTransfer() {
        console.log('\n开始手动执行转账...');
        return await this.scheduler.manualTransfer(this.privateKeys);
    }

    // 启动定时任务
    startScheduledTasks() {
        console.log('\n启动定时任务...');
        this.scheduler.startDailyTransferSchedule(this.privateKeys);
        
        const nextExecution = this.scheduler.getNextExecutionTime();
        console.log(`下次执行时间: ${Utils.formatTime(nextExecution)}`);
    }

    // 显示菜单
    showMenu() {
        console.log('\n' + '='.repeat(50));
        console.log('Gata自动化机器人控制面板');
        console.log('='.repeat(50));
        console.log('1. 执行Gata注册登录');
        console.log('2. 手动执行转账');
        console.log('3. 启动定时转账任务');
        console.log('4. 停止所有定时任务');
        console.log('5. 查看下次执行时间');
        console.log('6. 查看钱包状态');
        console.log('7. 启动任务循环 (每300秒)');
        console.log('8. 查看任务统计');
        console.log('9. 查看人机验证队列状态');
        console.log('0. 退出程序');
        console.log('='.repeat(50));
    }

    // 查看钱包状态 (异步多线程)
    async checkWalletStatus() {
        console.log('\n检查钱包状态...');
        
        // 限制检查前10个钱包，避免输出过多
        const keysToCheck = this.privateKeys.slice(0, 10);
        
        // 准备任务数据
        const tasks = keysToCheck.map((privateKey, index) => ({
            type: 'balance_check',
            data: { privateKey, index }
        }));

        try {
            // 使用工作线程管理器批量执行任务
            const results = await this.scheduler.workerManager.executeBatch(tasks);
            
            // 输出结果
            results.forEach((result, index) => {
                if (result.success) {
                    const balanceInBNB = (BigInt(result.data.balance) / BigInt(10**18)).toString();
                    console.log(`钱包 ${index + 1}: ${result.data.address} - 余额: ${balanceInBNB} BNB`);
                } else {
                    console.error(`钱包 ${index + 1} 状态检查失败: ${result.error}`);
                }
            });
            
            if (this.privateKeys.length > 10) {
                console.log(`\n... 还有 ${this.privateKeys.length - 10} 个钱包未显示`);
            }
        } catch (error) {
            console.error('批量钱包状态检查失败:', error.message);
        }
    }



    // 启动任务循环
    async startTaskLoop() {
        console.log('\n启动Gata任务循环 (每300秒执行一次)...');
        console.log(`将为 ${this.privateKeys.length} 个钱包启动独立的任务循环线程`);
        console.log('每个线程启动间隔: 10-20秒随机延迟');
        console.log('每个钱包将使用proxy.txt中的固定代理');
        
        try {
            // 设置最大线程数为钱包数量，确保每个钱包都有独立线程
            const originalMaxWorkers = this.scheduler.workerManager.maxWorkers;
            this.scheduler.workerManager.maxWorkers = this.privateKeys.length;
            
            console.log(`设置最大并发线程数: ${this.privateKeys.length} (每个钱包一个线程)`);
            
            const results = [];
            
            // 逐个启动每个钱包的任务循环，添加随机延迟
            for (let i = 0; i < this.privateKeys.length; i++) {
                const privateKey = this.privateKeys[i];
                const task = {
                    type: 'gata_task_loop',
                    data: { privateKey, intervalSeconds: 300, index: i, proxyIndex: i }
                };
                
                try {
                    console.log(`\n启动钱包 ${i + 1}/${this.privateKeys.length} 的任务循环...`);
                    
                    // 使用持续运行的任务循环（自动重启）
                    const taskId = `task_loop_${i}_${Date.now()}`;
                    
                    // 在后台启动持续运行的任务循环
                    this.scheduler.workerManager.executeContinuousTaskLoop(
                        task.type, 
                        task.data, 
                        taskId
                    ).catch(error => {
                        console.error(`钱包 ${i + 1} 持续任务循环最终失败: ${error.message}`);
                    });
                    
                    // 等待一小段时间让任务开始执行，然后获取地址信息
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // 创建一个临时的GataAuth实例来获取地址信息（使用固定代理）
                    const tempGataAuth = new GataAuth(privateKey, i);
                    
                    results.push({ success: true, data: { address: tempGataAuth.address } });
                    console.log(`钱包 ${i + 1} (${tempGataAuth.address}) 持续任务循环已启动 (线程 ${i + 1}, 代理索引: ${i}) - 异常时将自动重启`);
                    
                } catch (error) {
                    console.error(`钱包 ${i + 1} 任务循环启动失败: ${error.message}`);
                    results.push({ success: false, error: error.message });
                }
                
                // 如果不是最后一个钱包，添加随机延迟
                if (i < this.privateKeys.length - 1) {
                    const delay = Math.floor(Math.random() * (20000 - 10000 + 1)) + 10000; // 10-20秒随机延迟
                    console.log(`等待 ${delay/1000} 秒后启动下一个钱包...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            // 恢复原始线程数设置
            this.scheduler.workerManager.maxWorkers = originalMaxWorkers;
            
            // 统计结果
            const successCount = results.filter(r => r.success).length;
            const failureCount = results.filter(r => !r.success).length;
            
            console.log('\n任务循环启动完成');
            console.log(`成功启动: ${successCount}, 失败: ${failureCount}`);

            return results;
        } catch (error) {
            console.error('批量任务循环启动失败:', error.message);
            throw error;
        }
    }

    // 查看任务统计
    async showTaskStats() {
        console.log('\n查看任务统计...');
        
        // 只检查前5个钱包的统计信息
        const keysToCheck = this.privateKeys.slice(0, 5);
        
        for (let i = 0; i < keysToCheck.length; i++) {
            try {
                const privateKey = keysToCheck[i];
                const gataAuth = new GataAuth(privateKey);
                
                // 获取统计信息（会自动登录）
                const stats = await gataAuth.getTaskStats();
                
                console.log(`\n钱包 ${i + 1}: ${gataAuth.address}`);
                console.log(`  总积分: ${stats.totalPoints}`);
                console.log(`  完成任务数: ${stats.completedCount}`);
                console.log(`  今日积分: ${stats.todayPoints}`);
                
                if (stats.recentRewards.length > 0) {
                    console.log('  最近5天积分:');
                    stats.recentRewards.forEach(reward => {
                        console.log(`    ${reward.date}: ${reward.total_points}`);
                    });
                }
                
            } catch (error) {
                console.error(`钱包 ${i + 1} 统计获取失败:`, error.message);
            }
        }
        
        if (this.privateKeys.length > 5) {
            console.log(`\n... 还有 ${this.privateKeys.length - 5} 个钱包未显示`);
        }
    }

    // 查看人机验证队列状态
    async showCaptchaQueueStatus() {
        console.log('\n查看人机验证队列状态...');
        
        try {
            const captchaQueue = require('./captcha-queue');
            const status = captchaQueue.getStatus();
            
            console.log(`队列长度: ${status.queueLength}`);
            console.log(`正在执行: ${status.running}`);
            console.log(`最大并发: ${status.maxConcurrent}`);
            
            if (status.queueLength > 0) {
                console.log(`\n当前队列中有 ${status.queueLength} 个请求等待处理`);
            }
            
            if (status.running > 0) {
                console.log(`当前有 ${status.running} 个请求正在执行人机验证`);
            }
        } catch (error) {
            console.error('获取人机验证队列状态失败:', error.message);
        }
    }



    // 交互式菜单
    async interactiveMenu() {
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const askQuestion = (question) => {
            return new Promise((resolve) => {
                rl.question(question, resolve);
            });
        };

        while (this.isRunning) {
            this.showMenu();
            const choice = await askQuestion('请选择操作 (0-9): ');

            switch (choice.trim()) {
                case '1':
                    await this.executeGataRegistration();
                    break;
                case '2':
                    await this.executeManualTransfer();
                    break;
                case '3':
                    this.startScheduledTasks();
                    break;
                case '4':
                    await this.scheduler.stopAllTasks();
                    break;
                case '5':
                    const nextTime = this.scheduler.getNextExecutionTime();
                    console.log(`下次执行时间: ${Utils.formatTime(nextTime)}`);
                    break;
                case '6':
                    await this.checkWalletStatus();
                    break;
                case '7':
                    await this.startTaskLoop();
                    break;
                case '8':
                    await this.showTaskStats();
                    break;
                case '9':
                    await this.showCaptchaQueueStatus();
                    break;
                case '0':
                    console.log('正在退出程序...');
                    this.isRunning = false;
                    await this.scheduler.stopAllTasks();
                    break;
                default:
                    console.log('无效选择，请重新输入');
            }

            if (this.isRunning) {
                await askQuestion('\n按回车键继续...');
            }
        }

        rl.close();
    }

    // 启动机器人
    async start() {
        try {
            await this.initialize();
            
            // 检查命令行参数
            const args = process.argv.slice(2);
            
            if (args.includes('--auto')) {
                // 自动模式：执行注册登录后启动定时任务
                console.log('自动模式启动...');
                await this.executeGataRegistration();
                this.startScheduledTasks();
                
                // 保持程序运行
                console.log('程序将保持运行，等待定时任务执行...');
                console.log('按 Ctrl+C 退出程序');
                
                process.on('SIGINT', async () => {
                    console.log('\n收到退出信号，正在停止所有任务...');
                    await this.scheduler.stopAllTasks();
                    process.exit(0);
                });
                
                // 保持进程运行
                setInterval(() => {
                    // 每小时输出一次状态
                }, 3600000);
                
            } else {
                // 交互模式
                await this.interactiveMenu();
            }
            
        } catch (error) {
            console.error('程序启动失败:', error.message);
            process.exit(1);
        }
    }
}

// 启动程序
if (require.main === module) {
    const bot = new GataBot();
    bot.start().catch(error => {
        console.error('程序运行出错:', error);
        process.exit(1);
    });
}

module.exports = GataBot;