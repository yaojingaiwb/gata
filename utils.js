const fs = require('fs').promises;
const path = require('path');

class Utils {
    // 读取私钥文件
    static async readPrivateKeys(filePath = 'keys.txt') {
        try {
            console.log(`读取私钥文件: ${filePath}`);
            
            const content = await fs.readFile(filePath, 'utf8');
            const lines = content.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
            
            const privateKeys = lines.map(key => {
                // 确保私钥有0x前缀
                return key.startsWith('0x') ? key : '0x' + key;
            });
            
            console.log(`成功读取 ${privateKeys.length} 个私钥`);
            return privateKeys;
        } catch (error) {
            console.error('读取私钥文件失败:', error.message);
            throw error;
        }
    }

    // 延迟函数
    static async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 随机延迟
    static async randomDelay(min = 1000, max = 5000) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        console.log(`随机延迟 ${delay}ms`);
        await this.delay(delay);
    }

    // 格式化时间
    static formatTime(date = new Date()) {
        return date.toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    // 记录日志到文件
    static async logToFile(message, filename = 'app.log') {
        try {
            const timestamp = this.formatTime();
            const logMessage = `[${timestamp}] ${message}\n`;
            await fs.appendFile(filename, logMessage);
        } catch (error) {
            console.error('写入日志文件失败:', error.message);
        }
    }

    // 验证私钥格式
    static isValidPrivateKey(privateKey) {
        const key = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
        return /^[0-9a-fA-F]{64}$/.test(key);
    }

    // 验证以太坊地址格式
    static isValidAddress(address) {
        return /^0x[0-9a-fA-F]{40}$/.test(address);
    }

    // 批量处理，支持并发控制
    static async batchProcess(items, processor, concurrency = 5) {
        const results = [];
        const executing = [];

        for (const item of items) {
            const promise = processor(item).then(result => {
                executing.splice(executing.indexOf(promise), 1);
                return result;
            });

            results.push(promise);
            executing.push(promise);

            if (executing.length >= concurrency) {
                await Promise.race(executing);
            }
        }

        return Promise.all(results);
    }

    // 重试机制
    static async retry(fn, maxRetries = 3, delay = 1000) {
        let lastError;
        
        for (let i = 0; i <= maxRetries; i++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                console.log(`尝试 ${i + 1}/${maxRetries + 1} 失败:`, error.message);
                
                if (i < maxRetries) {
                    await this.delay(delay * Math.pow(2, i)); // 指数退避
                }
            }
        }
        
        throw lastError;
    }
}

module.exports = Utils;