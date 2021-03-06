(function(window) {

//
function SpaceRock(size) {
	this.initialize(size);
}

var p = SpaceRock.prototype = new createjs.Shape();

// 静态属性
	SpaceRock.LRG_ROCK = 40;
	SpaceRock.MED_ROCK = 20;
	SpaceRock.SML_ROCK = 10;

// 公共属性

	p.bounds;	//可视区域范围
	p.hit;		//平均可视区域差
	
	p.size;		//尺寸值
	p.spin;		//旋转范围
	p.score;	//分数
	
	p.vX;		//X轴速率
	p.vY;		//Y轴速率
	
	p.active;	//是否处于激活状态
	
// 构造方法:
	p.Shape_initialize = p.initialize;	//避免覆盖原生的方法
	
	p.initialize = function(size) {
		this.Shape_initialize(); //调用父方法
		
		this.activate(size);
	}
	
// 公有方法:
	//绘制一个陨石
	p.getShape = function(size) {
		var angle = 0;
		var radius = size;
		
		this.size = size;
		this.hit = size;
		this.bounds = 0;
		
		//设置参数
		this.graphics.clear();
		this.graphics.beginStroke("#FFFFFF");
		
		this.graphics.moveTo(0, size);
		//开始绘制
		while(angle < (Math.PI*2 - .5)) {
			angle += .25+(Math.random()*100)/500;
			radius = size+(size/2*Math.random());
			this.graphics.lineTo(Math.sin(angle)*radius, Math.cos(angle)*radius);
			
			//记录可视信息，方便交互使用
			if(radius > this.bounds) { this.bounds = radius; }	//最远的点
			this.hit = (this.hit + radius) / 2;					//计算均值
		}
		
		this.graphics.closePath(); // 绘制最后一个点至起始点的连线
		this.hit *= 1.1; //放大一点点
	}
	
	//处理重新初始化的操作，是为了共用的目的
	p.activate = function(size) {
		this.getShape(size);	
		
		//选择一个随机的移动方向
		var angle = Math.random()*(Math.PI*2);
		this.vX = Math.sin(angle)*(5 - size/10);
		this.vY = Math.cos(angle)*(5 - size/10);
		this.spin = (Math.random() + 0.2 )* this.vX;
		
		//把尺寸和分数结合起来
		this.score = (5 - size/10) * 100;
		this.active = true;
	}
	
	//处理陨石的自转和移动
	p.tick = function() {
		this.rotation += this.spin;
		this.x += this.vX;
		this.y += this.vY;
	}
	
	//把陨石定位在屏幕上，使它可以漂浮
	p.floatOnScreen = function(width, height) {	    //在实际场景下基于对焦原则，选择一个起始位置
		if(Math.random()*(width+height) > width) {
			//屏幕两边，确保它的速度可以把它推出到屏幕上
			if(this.vX > 0) {
				this.x = -2 * this.bounds;
			} else {
				this.x = 2 * this.bounds + width;
			}
			//上下方的随机位置
			if(this.vY > 0) {
				this.y = Math.random()*height*0.5;
			} else {
				this.y = Math.random()*height*0.5 + 0.5*height;
			}
		} else {
			//屏幕上下方，确保它的速度可以把它推出到屏幕上
			if(this.vY > 0) {
				this.y = -2 * this.bounds;
			} else {
				this.y = 2 * this.bounds + height;
			}
			//屏幕左右两边的随机位置
			if(this.vX > 0) {
				this.x = Math.random()*width*0.5;
			} else {
				this.x = Math.random()*width*0.5 + 0.5*width;
			}
		}
	}
	
	p.hitPoint = function(tX, tY) {
		return this.hitRadius(tX, tY, 0);
	}
	
	p.hitRadius = function(tX, tY, tHit) {
		if(tX - tHit > this.x + this.hit) { return; }
		if(tX + tHit < this.x - this.hit) { return; }
		if(tY - tHit > this.y + this.hit) { return; }
		if(tY + tHit < this.y - this.hit) { return; }
		return this.hit + tHit > Math.sqrt(Math.pow(Math.abs(this.x - tX),2) + Math.pow(Math.abs(this.y - tY),2));
	}


window.SpaceRock = SpaceRock;
}(window));