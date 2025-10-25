const CUSTOMER_SITES = {
    xiaomaomi: {
    api: 'http://zy.xmm.hk/api.php/provide/vod/?ac=videolist&wd=',  // 完整路径
    name: '小猫咪资源',
    detail: 'http://zy.xmm.hk',
    customPath: true  // 标记使用自定义路径
    }
};

// 调用全局方法合并
if (window.extendAPISites) {
    window.extendAPISites(CUSTOMER_SITES);
} else {
    console.error("错误：请先加载 config.js！");
}
