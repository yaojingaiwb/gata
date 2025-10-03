const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const os = require('os');

class WorkerManager {
    constructor(maxWorkers = os.cpus().length) {
        this.maxWorkers = maxWorkers;
        this.activeWorkers = new Set();
        this.taskQueue = [];
        this.results = new Map();
        this.maxRetries = 5; // 最大重试次数
    }

    // 创建工作线程执行任务
    async executeTask(taskType, taskData, taskId) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(__filename, {
                workerData: {
                    taskType,
                    taskData,
                    taskId
                }
            });

            this.activeWorkers.add(worker);

            worker.on('message', (result) => {
                this.activeWorkers.delete(worker);
                
                if (result.success) {
                    resolve(result.data);
                } else {
                    reject(new Error(result.error));
                }
            });

            worker.on('error', (error) => {
                this.activeWorkers.delete(worker);
                // 不直接reject，而是记录错误并继续
                console.warn(`工作线程错误 (${taskId}): ${error.message}`);
                reject(error);
            });

            worker.on('exit', (code) => {
                this.activeWorkers.delete(worker);
                if (code !== 0) {
                    // 不直接reject，而是记录错误并继续
                    console.warn(`工作线程异常退出 (${taskId})，代码: ${code}`);
                    reject(new Error(`工作线程异常退出，代码: ${code}`));
                }
            });
        });
    }

    // 延迟函数
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 带重试功能的任务执行
    async executeTaskWithRetry(taskType, taskData, taskId, retryCount = 0) {
        try {
            const result = await this.executeTask(taskType, taskData, taskId);
            if (retryCount > 0) {
                console.log(`任务 ${taskId} 在第 ${retryCount + 1} 次尝试后成功`);
            }
            return result;
        } catch (error) {
            if (retryCount < this.maxRetries) {
                const delayMs = Math.pow(2, retryCount) * 1000; // 指数退避：1s, 2s, 4s, 8s, 16s
                console.warn(`任务 ${taskId} 失败 (第 ${retryCount + 1} 次尝试): ${error.message}`);
                console.log(`等待 ${delayMs/1000} 秒后重试...`);
                
                await this.delay(delayMs);
                return this.executeTaskWithRetry(taskType, taskData, taskId, retryCount + 1);
            } else {
                console.error(`任务 ${taskId} 在 ${this.maxRetries + 1} 次尝试后最终失败: ${error.message}`);
                throw error;
            }
        }
    }

    // 持续运行的任务循环（自动重启）
    async executeContinuousTaskLoop(taskType, taskData, taskId) {
        let restartCount = 0;
        const maxRestarts = 100; // 最大重启次数，防止无限重启
        
        while (restartCount < maxRestarts) {
            try {
                console.log(`启动任务循环 ${taskId} (第 ${restartCount + 1} 次启动)`);
                
                // 执行任务循环
                await this.executeTask(taskType, taskData, taskId);
                
                // 如果任务正常完成（不是异常退出），则退出循环
                console.log(`任务循环 ${taskId} 正常完成，不再重启`);
                break;
                
            } catch (error) {
                restartCount++;
                console.error(`任务循环 ${taskId} 异常退出 (第 ${restartCount} 次): ${error.message}`);
                
                if (restartCount >= maxRestarts) {
                    console.error(`任务循环 ${taskId} 达到最大重启次数 (${maxRestarts})，停止重启`);
                    throw new Error(`任务循环达到最大重启次数: ${error.message}`);
                }
                
                // 等待一段时间后重启
                const restartDelay = Math.min(30000 + (restartCount * 5000), 120000); // 30秒到2分钟
                console.log(`等待 ${restartDelay/1000} 秒后重启任务循环 ${taskId}...`);
                await this.delay(restartDelay);
            }
        }
    }

    // 批量执行任务
    async executeBatch(tasks) {
        console.log(`开始批量执行 ${tasks.length} 个任务，最大并发线程数: ${this.maxWorkers}`);
        
        const results = new Array(tasks.length); // 预分配结果数组
        const executing = [];
        const taskIndexMap = new Map(); // 映射执行中的任务到原始索引
        let completedCount = 0;
        let successCount = 0;
        let failureCount = 0;

        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            const taskId = `task_${i}_${Date.now()}`;

            // 如果达到最大并发数，等待一个任务完成
            if (executing.length >= this.maxWorkers) {
                console.log(`已达到最大并发数 ${this.maxWorkers}，等待任务完成...`);
                
                const completedIndex = await Promise.race(
                    executing.map((promise, index) => 
                        promise.then(() => index).catch(() => index)
                    )
                );
                
                const completed = executing.splice(completedIndex, 1)[0];
                const originalIndex = taskIndexMap.get(completed);
                taskIndexMap.delete(completed);
                
                try {
                    const result = await completed;
                    results[originalIndex] = { success: true, data: result, taskId };
                    successCount++;
                    console.log(`任务 ${originalIndex + 1}/${tasks.length} 完成 (成功)`);
                } catch (error) {
                    results[originalIndex] = { success: false, error: error.message, taskId };
                    failureCount++;
                    console.warn(`任务 ${originalIndex + 1}/${tasks.length} 完成 (失败): ${error.message}`);
                }
                completedCount++;
            }

            // 启动新任务（带重试功能）
            console.log(`启动任务 ${i + 1}/${tasks.length} (活跃线程: ${this.activeWorkers.size})`);
            const taskPromise = this.executeTaskWithRetry(task.type, task.data, taskId);
            executing.push(taskPromise);
            taskIndexMap.set(taskPromise, i); // 记录任务对应的原始索引
        }

        // 等待所有剩余任务完成
        console.log(`等待剩余 ${executing.length} 个任务完成...`);
        const remainingResults = await Promise.allSettled(executing);
        
        remainingResults.forEach((result, index) => {
            const taskPromise = executing[index];
            const originalIndex = taskIndexMap.get(taskPromise);
            
            if (result.status === 'fulfilled') {
                results[originalIndex] = { success: true, data: result.value, taskId: `task_${originalIndex}` };
                successCount++;
                console.log(`任务 ${originalIndex + 1}/${tasks.length} 完成 (成功)`);
            } else {
                results[originalIndex] = { success: false, error: result.reason.message, taskId: `task_${originalIndex}` };
                failureCount++;
                console.warn(`任务 ${originalIndex + 1}/${tasks.length} 完成 (失败): ${result.reason.message}`);
            }
            completedCount++;
        });

        console.log(`批量任务执行完成，总计: ${completedCount}/${tasks.length}，成功: ${successCount}，失败: ${failureCount}`);
        return results;
    }

    // 关闭所有工作线程
    async shutdown() {
        const shutdownPromises = Array.from(this.activeWorkers).map(worker => {
            return new Promise((resolve) => {
                worker.terminate().then(resolve).catch(resolve);
            });
        });

        await Promise.all(shutdownPromises);
        this.activeWorkers.clear();
    }
}

// 工作线程代码
if (!isMainThread) {
    const { taskType, taskData, taskId } = workerData;

    (async () => {
        try {
            let result;

            switch (taskType) {
                case 'gata_auth':
                    result = await executeGataAuth(taskData);
                    break;
                case 'transfer':
                    result = await executeTransfer(taskData);
                    break;
                case 'balance_check':
                    result = await executeBalanceCheck(taskData);
                    break;
                case 'gata_task_loop':
                    result = await executeGataTaskLoop(taskData);
                    break;
                default:
                    throw new Error(`未知任务类型: ${taskType}`);
            }

            parentPort.postMessage({
                success: true,
                data: result,
                taskId
            });
        } catch (error) {
            // 记录详细错误信息
            console.error(`工作线程任务失败 (${taskId}): ${error.message}`);
            
            parentPort.postMessage({
                success: false,
                error: error.message,
                taskId
            });
        }
    })();

    // Gata认证任务
    async function executeGataAuth(data) {
        const GataAuth = require('./gata-auth');
        const { privateKey, inviteCode } = data;
        
        const gataAuth = new GataAuth(privateKey);
        const result = await gataAuth.login(inviteCode);
        
        return {
            address: gataAuth.address,
            token: gataAuth.token,
            result: result
        };
    }

    // 转账任务
    async function executeTransfer(data) {
        const TransferManager = require('./transfer');
        const { privateKey } = data;
        
        try {
            const transferManager = new TransferManager(privateKey);
            const results = await transferManager.executeDailyTransfers();
            
            return {
                address: transferManager.address,
                results: results
            };
        } catch (error) {
            // 记录转账错误但不抛出，让重试机制处理
            console.warn(`转账任务失败 (${data.privateKey?.slice(0, 10)}...): ${error.message}`);
            throw error;
        }
    }

    // 余额检查任务
    async function executeBalanceCheck(data) {
        const TransferManager = require('./transfer');
        const { privateKey } = data;
        
        const transferManager = new TransferManager(privateKey);
        const balance = await transferManager.getBalance();
        
        return {
            address: transferManager.address,
            balance: balance.toString()
        };
    }

    // Gata任务循环执行
    async function executeGataTaskLoop(data) {
        const GataAuth = require('./gata-auth');
        const { privateKey, intervalSeconds, proxyIndex } = data;
        
        // 使用代理索引创建GataAuth实例（如果提供了代理索引）
        const gataAuth = new GataAuth(privateKey, proxyIndex);
        
        // 开始任务循环（会自动登录）
        await gataAuth.executeTaskLoop(intervalSeconds || 500);
        
        return {
            address: gataAuth.address,
            status: 'task_loop_started',
            proxyIndex: proxyIndex
        };
    }


}

module.exports = WorkerManager;